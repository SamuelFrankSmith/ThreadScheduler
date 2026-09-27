/**
 * Date/interval parsing and next-run computation. All times are UTC.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

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

const DATETIME_RE = /^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/;

/**
 * Parses `MM/dd HH:mm` (24h, UTC). Uses the current year, or next year if that
 * moment has already passed.
 */
export function parseDateTime(input: string, now: number = Date.now()): ParseResult<number> {
  const match = DATETIME_RE.exec(input.trim());
  if (!match) {
    return { ok: false, error: 'Datetime must be in the format `MM/dd HH:mm` (24-hour, UTC), e.g. `03/14 18:30`.' };
  }
  const [month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number];
  if (month < 1 || month > 12) return { ok: false, error: `Invalid month \`${month}\`.` };
  if (hour > 23) return { ok: false, error: `Invalid hour \`${hour}\`.` };
  if (minute > 59) return { ok: false, error: `Invalid minute \`${minute}\`.` };

  const year = new Date(now).getUTCFullYear();
  for (const y of [year, year + 1]) {
    const date = new Date(Date.UTC(y, month - 1, day, hour, minute));
    // Reject overflowed dates like 02/30, but allow 02/29 to roll to a leap year.
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) continue;
    if (date.getTime() > now) return { ok: true, value: date.getTime() };
  }
  // 02/29 can be up to 4 years away; search a little further before giving up.
  for (let y = year + 2; y <= year + 4; y++) {
    const date = new Date(Date.UTC(y, month - 1, day, hour, minute));
    if (date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return { ok: true, value: date.getTime() };
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
 * - Daily time: `18:30` or `18:30hr` — repeat every day at 18:30 UTC.
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

function hasCalendarUnits(p: DurationParts): boolean {
  return p.years > 0 || p.months > 0;
}

function fixedMs(p: DurationParts): number {
  return p.weeks * WEEK + p.days * DAY + p.hours * HOUR + p.minutes * MINUTE;
}

/** Adds `n` repetitions of a duration to `start`, clamping month-end days (Jan 31 + 1mo = Feb 28/29). */
function addDuration(start: number, p: DurationParts, n: number): number {
  const d = new Date(start);
  if (hasCalendarUnits(p)) {
    const totalMonths = d.getUTCMonth() + n * (p.years * 12 + p.months);
    const year = d.getUTCFullYear() + Math.floor(totalMonths / 12);
    const month = ((totalMonths % 12) + 12) % 12;
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    d.setUTCFullYear(year, month, Math.min(d.getUTCDate(), daysInMonth));
  }
  return d.getTime() + n * fixedMs(p);
}

/**
 * Returns the first occurrence strictly after `after`.
 *
 * Duration intervals are anchored to `startAt` (occurrences are startAt + n·interval),
 * so there is no drift. Daily intervals return the next HH:mm UTC after `after`.
 * If the bot was down and several occurrences were missed, they are skipped.
 */
export function computeNextRun(startAt: number, interval: Interval, after: number): number {
  if (interval.kind === 'daily') {
    const d = new Date(Math.max(after, startAt));
    let candidate = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), interval.hour, interval.minute);
    while (candidate <= after) candidate += DAY;
    return candidate;
  }

  const p = interval.parts;
  if (startAt > after) return startAt;
  if (!hasCalendarUnits(p)) {
    const step = fixedMs(p);
    const n = Math.floor((after - startAt) / step) + 1;
    return startAt + n * step;
  }
  // Calendar units: estimate n from an average month length, then walk.
  const approxStep = (p.years * 12 + p.months) * 30 * DAY + fixedMs(p);
  let n = Math.max(1, Math.floor((after - startAt) / approxStep) - 1);
  while (addDuration(startAt, p, n) > after && n > 1) n--;
  while (addDuration(startAt, p, n) <= after) n++;
  return addDuration(startAt, p, n);
}

/** Computes the next run for a schedule that is being created or edited. */
export function initialNextRun(startAt: number, interval: Interval | null, now: number = Date.now()): number | null {
  if (startAt > now) return startAt;
  return interval ? computeNextRun(startAt, interval, now) : null;
}

const UNIT_LABELS: [keyof DurationParts, string][] = [
  ['years', 'year'],
  ['months', 'month'],
  ['weeks', 'week'],
  ['days', 'day'],
  ['hours', 'hour'],
  ['minutes', 'minute'],
];

const pad = (n: number) => String(n).padStart(2, '0');

export function describeInterval(interval: Interval): string {
  if (interval.kind === 'daily') {
    return `daily at ${pad(interval.hour)}:${pad(interval.minute)} UTC`;
  }
  const pieces = UNIT_LABELS.filter(([k]) => interval.parts[k] > 0).map(
    ([k, label]) => `${interval.parts[k]} ${label}${interval.parts[k] === 1 ? '' : 's'}`,
  );
  return `every ${pieces.join(' ')}`;
}

/** `MM/dd/yyyy HH:mm UTC` */
export function formatUtc(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** `MM/dd HH:mm`, the input format — used to prefill edit fields. */
export function formatInput(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Discord timestamp markup, renders in each viewer's local time. */
export function discordTimestamp(ms: number, style: 'F' | 'R' | 'f' = 'F'): string {
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}
