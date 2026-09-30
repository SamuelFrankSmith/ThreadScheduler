/**
 * Date/interval parsing and next-run computation.
 *
 * Instants are stored as epoch ms. User-facing times (input, display, daily
 * intervals, day/week/month/year steps) are wall-clock times in an IANA
 * timezone, so a daily 09:00 schedule stays at 09:00 across DST changes.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface DurationParts {
  years: number;
  months: number;
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
}

export type Interval =
  | { kind: 'duration'; parts: DurationParts }
  | { kind: 'daily'; hour: number; minute: number };

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** A wall-clock time in some timezone. `month` is 1-12. */
interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

// ---------- Timezone helpers ----------

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function partFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    partFormatters.set(timeZone, f);
  }
  return f;
}

function wallTime(ms: number, timeZone: string): WallTime & { second: number } {
  const parts: Record<string, number> = {};
  for (const p of partFormatter(timeZone).formatToParts(ms)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour!,
    minute: parts.minute!,
    second: parts.second!,
  };
}

/** Offset of the timezone from UTC at the given instant, in ms. */
function offsetAt(ms: number, timeZone: string): number {
  const w = wallTime(ms, timeZone);
  const floored = ms - (((ms % 1000) + 1000) % 1000);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - floored;
}

/**
 * Converts a wall-clock time to an instant. Times skipped by a DST jump land
 * just after the jump; repeated times resolve to one of the two instants.
 */
function wallToInstant(w: WallTime, timeZone: string): number {
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  const guess = asUtc - offsetAt(asUtc, timeZone);
  return asUtc - offsetAt(guess, timeZone);
}

function addDays(w: WallTime, days: number): WallTime {
  const d = new Date(Date.UTC(w.year, w.month - 1, w.day + days));
  return { ...w, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Adds months, clamping the day to the target month's length (Jan 31 + 1mo = Feb 28/29). */
function addMonths(w: WallTime, months: number): WallTime {
  const total = w.month - 1 + months;
  const year = w.year + Math.floor(total / 12);
  const month = (((total % 12) + 12) % 12) + 1;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { ...w, year, month, day: Math.min(w.day, daysInMonth) };
}

function isRealDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

// ---------- Parsing ----------

const DATETIME_RE = /^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/;

/**
 * Parses `MM/dd HH:mm` (24h) in the given timezone. Uses the current year, or
 * the next year in which that moment is still in the future.
 */
export function parseDateTime(input: string, timeZone: string, now: number = Date.now()): ParseResult<number> {
  const match = DATETIME_RE.exec(input.trim());
  if (!match) {
    return { ok: false, error: 'Datetime must be in the format `MM/dd HH:mm` (24-hour), e.g. `03/14 18:30`.' };
  }
  const [month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number];
  if (month < 1 || month > 12) return { ok: false, error: `Invalid month \`${month}\`.` };
  if (hour > 23) return { ok: false, error: `Invalid hour \`${hour}\`.` };
  if (minute > 59) return { ok: false, error: `Invalid minute \`${minute}\`.` };

  // Up to 4 years ahead so 02/29 can reach the next leap year.
  const thisYear = wallTime(now, timeZone).year;
  for (let year = thisYear; year <= thisYear + 4; year++) {
    if (!isRealDate(year, month, day)) continue;
    const instant = wallToInstant({ year, month, day, hour, minute }, timeZone);
    if (instant > now) return { ok: true, value: instant };
  }
  return { ok: false, error: `\`${month}/${day}\` is not a valid date.` };
}

const DAILY_RE = /^(\d{1,2}):(\d{2})\s*(?:hrs?|h)?$/;
const DURATION_TOKEN_RE =
  /(\d+)\s*(years?|yrs?|y|months?|mos?|weeks?|wks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|m)(?![a-z])/g;

function unitKey(unit: string): keyof DurationParts {
  if (unit.startsWith('y')) return 'years';
  if (unit.startsWith('mo')) return 'months';
  if (unit.startsWith('w')) return 'weeks';
  if (unit.startsWith('d')) return 'days';
  if (unit.startsWith('h')) return 'hours';
  return 'minutes';
}

/**
 * Parses an interval. Accepted forms:
 * - Durations: `30m`, `6h`, `6hr`, `1d`, `2w`, `1mo`, `1y`, combinable (`1d6h`, `1d 6h`).
 * - Daily time: `18:30` or `18:30hr` — repeat every day at 18:30.
 */
export function parseInterval(input: string): ParseResult<Interval> {
  const text = input.trim().toLowerCase();
  const invalid: ParseResult<Interval> = {
    ok: false,
    error:
      'Interval must be a duration like `30m`, `6hr`, `1d`, `2w`, `1mo`, `1y` (combinable, e.g. `1d6h`), ' +
      'or a daily time like `18:30hr`.',
  };
  if (!text) return invalid;

  const daily = DAILY_RE.exec(text);
  if (daily) {
    const hour = Number(daily[1]);
    const minute = Number(daily[2]);
    if (hour > 23 || minute > 59) return { ok: false, error: `\`${input.trim()}\` is not a valid time of day.` };
    return { ok: true, value: { kind: 'daily', hour, minute } };
  }

  const parts: DurationParts = { years: 0, months: 0, weeks: 0, days: 0, hours: 0, minutes: 0 };
  let consumed = '';
  for (const match of text.matchAll(DURATION_TOKEN_RE)) {
    parts[unitKey(match[2]!)] += Number(match[1]);
    consumed += match[0];
  }
  // Every non-space character must belong to a token.
  if (consumed.replace(/\s/g, '') !== text.replace(/\s/g, '')) return invalid;

  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  if (total === 0) return { ok: false, error: 'Interval must be at least 1 minute.' };
  return { ok: true, value: { kind: 'duration', parts } };
}

// ---------- Next-run computation ----------

/** Years/months/weeks/days step on the calendar; hours/minutes are elapsed time. */
function hasCalendarUnits(p: DurationParts): boolean {
  return p.years > 0 || p.months > 0 || p.weeks > 0 || p.days > 0;
}

function clockMs(p: DurationParts): number {
  return p.hours * HOUR + p.minutes * MINUTE;
}

function addDuration(start: number, p: DurationParts, n: number, timeZone: string): number {
  let w: WallTime = wallTime(start, timeZone);
  if (p.years > 0 || p.months > 0) w = addMonths(w, n * (p.years * 12 + p.months));
  if (p.weeks > 0 || p.days > 0) w = addDays(w, n * (p.weeks * 7 + p.days));
  return wallToInstant(w, timeZone) + n * clockMs(p);
}

/**
 * Returns the first occurrence strictly after `after`.
 *
 * Duration intervals are anchored to `startAt` (occurrences are startAt + n·interval),
 * so there is no drift. Daily intervals return the next HH:mm after `after`.
 * If the bot was down and several occurrences were missed, they are skipped.
 */
export function computeNextRun(startAt: number, interval: Interval, after: number, timeZone: string): number {
  if (interval.kind === 'daily') {
    let w: WallTime = { ...wallTime(Math.max(after, startAt), timeZone), hour: interval.hour, minute: interval.minute };
    let candidate = wallToInstant(w, timeZone);
    while (candidate <= after) {
      w = addDays(w, 1);
      candidate = wallToInstant(w, timeZone);
    }
    return candidate;
  }

  const p = interval.parts;
  if (startAt > after) return startAt;
  if (!hasCalendarUnits(p)) {
    const step = clockMs(p);
    const n = Math.floor((after - startAt) / step) + 1;
    return startAt + n * step;
  }
  // Calendar units: estimate n from average lengths, then walk to the exact answer.
  const approxStep = ((p.years * 12 + p.months) * 30 + p.weeks * 7 + p.days) * DAY + clockMs(p);
  let n = Math.max(1, Math.floor((after - startAt) / approxStep) - 1);
  while (n > 1 && addDuration(startAt, p, n, timeZone) > after) n--;
  while (addDuration(startAt, p, n, timeZone) <= after) n++;
  return addDuration(startAt, p, n, timeZone);
}

/** Computes the next run for a schedule that is being created or edited. */
export function initialNextRun(
  startAt: number,
  interval: Interval | null,
  timeZone: string,
  now: number = Date.now(),
): number | null {
  if (startAt > now) return startAt;
  return interval ? computeNextRun(startAt, interval, now, timeZone) : null;
}

// ---------- Formatting ----------

const UNIT_LABELS: [keyof DurationParts, string][] = [
  ['years', 'year'],
  ['months', 'month'],
  ['weeks', 'week'],
  ['days', 'day'],
  ['hours', 'hour'],
  ['minutes', 'minute'],
];

const pad = (n: number) => String(n).padStart(2, '0');

export function describeInterval(interval: Interval, timeZone: string): string {
  if (interval.kind === 'daily') {
    return `daily at ${pad(interval.hour)}:${pad(interval.minute)} (${timeZone})`;
  }
  const pieces = UNIT_LABELS.filter(([k]) => interval.parts[k] > 0).map(
    ([k, label]) => `${interval.parts[k]} ${label}${interval.parts[k] === 1 ? '' : 's'}`,
  );
  return `every ${pieces.join(' ')}`;
}

function zoneAbbreviation(ms: number, timeZone: string): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
    .formatToParts(ms)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? timeZone;
}

/** `MM/dd/yyyy HH:mm ZONE`, e.g. `07/01/2026 09:00 EDT`. */
export function formatDateTime(ms: number, timeZone: string): string {
  const w = wallTime(ms, timeZone);
  return `${pad(w.month)}/${pad(w.day)}/${w.year} ${pad(w.hour)}:${pad(w.minute)} ${zoneAbbreviation(ms, timeZone)}`;
}

/** `MM/dd HH:mm`, the input format — used to prefill edit fields. */
export function formatInput(ms: number, timeZone: string): string {
  const w = wallTime(ms, timeZone);
  return `${pad(w.month)}/${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}`;
}

/** Discord timestamp markup, renders in each viewer's local time. */
export function discordTimestamp(ms: number, style: 'F' | 'R' | 'f' = 'F'): string {
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}
