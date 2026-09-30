import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeNextRun,
  describeInterval,
  formatDateTime,
  formatInput,
  initialNextRun,
  isValidTimeZone,
  parseDateTime,
  parseInterval,
  type Interval,
} from './time.js';

const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
const UTC = 'UTC';
const NY = 'America/New_York';

function interval(s: string): Interval {
  const r = parseInterval(s);
  assert.ok(r.ok, `expected ${s} to parse`);
  return r.value;
}

describe('parseDateTime', () => {
  const now = utc(2026, 9, 26, 12, 0);

  it('uses the current year when in the future', () => {
    assert.deepEqual(parseDateTime('10/01 18:30', UTC, now), { ok: true, value: utc(2026, 10, 1, 18, 30) });
  });

  it('rolls to next year when already past', () => {
    assert.deepEqual(parseDateTime('01/15 08:00', UTC, now), { ok: true, value: utc(2027, 1, 15, 8, 0) });
  });

  it('rolls 02/29 forward to the next leap year', () => {
    assert.deepEqual(parseDateTime('02/29 00:00', UTC, now), { ok: true, value: utc(2028, 2, 29) });
  });

  it('interprets input in the configured timezone, including DST', () => {
    // EST (UTC-5) in January, EDT (UTC-4) in July.
    assert.deepEqual(parseDateTime('01/15 09:00', NY, now), { ok: true, value: utc(2027, 1, 15, 14, 0) });
    assert.deepEqual(parseDateTime('12/01 09:00', NY, now), { ok: true, value: utc(2026, 12, 1, 14, 0) });
    assert.deepEqual(parseDateTime('10/01 09:00', NY, now), { ok: true, value: utc(2026, 10, 1, 13, 0) });
  });

  it('rejects invalid input', () => {
    for (const bad of ['02/30 10:00', '13/01 10:00', '10/01 24:00', '10/01 10:60', '2026-10-01 10:00', '10/01']) {
      assert.equal(parseDateTime(bad, UTC, now).ok, false, bad);
    }
  });
});

describe('parseInterval', () => {
  it('parses durations', () => {
    assert.equal(describeInterval(interval('1d'), UTC), 'every 1 day');
    assert.equal(describeInterval(interval('6hr'), UTC), 'every 6 hours');
    assert.equal(describeInterval(interval('1y'), UTC), 'every 1 year');
    assert.equal(describeInterval(interval('1d6h'), UTC), 'every 1 day 6 hours');
    assert.equal(describeInterval(interval('2w 30m'), UTC), 'every 2 weeks 30 minutes');
    assert.equal(describeInterval(interval('1mo'), UTC), 'every 1 month');
  });

  it('parses daily times', () => {
    assert.deepEqual(interval('18:30hr'), { kind: 'daily', hour: 18, minute: 30 });
    assert.deepEqual(interval('7:05'), { kind: 'daily', hour: 7, minute: 5 });
    assert.equal(describeInterval(interval('18:30hr'), NY), 'daily at 18:30 (America/New_York)');
  });

  it('rejects invalid input', () => {
    for (const bad of ['', 'abc', '0d', '1x', '25:00', '1d foo', 'd1']) {
      assert.equal(parseInterval(bad).ok, false, bad);
    }
  });
});

describe('computeNextRun', () => {
  it('advances fixed durations anchored to start, skipping missed runs', () => {
    const start = utc(2026, 1, 1, 9, 0);
    assert.equal(computeNextRun(start, interval('6h'), start, UTC), utc(2026, 1, 1, 15, 0));
    assert.equal(computeNextRun(start, interval('6h'), utc(2026, 1, 3, 10, 0), UTC), utc(2026, 1, 3, 15, 0));
  });

  it('clamps month ends without drifting', () => {
    const start = utc(2026, 1, 31, 12, 0);
    assert.equal(computeNextRun(start, interval('1mo'), start, UTC), utc(2026, 2, 28, 12, 0));
    assert.equal(computeNextRun(start, interval('1mo'), utc(2026, 2, 28, 12, 0), UTC), utc(2026, 3, 31, 12, 0));
    assert.equal(computeNextRun(start, interval('1y'), start, UTC), utc(2027, 1, 31, 12, 0));
  });

  it('runs daily at the configured time', () => {
    const start = utc(2026, 5, 1, 9, 0);
    assert.equal(computeNextRun(start, interval('18:30hr'), start, UTC), utc(2026, 5, 1, 18, 30));
    assert.equal(computeNextRun(start, interval('18:30hr'), utc(2026, 5, 1, 18, 30), UTC), utc(2026, 5, 2, 18, 30));
  });

  it('keeps day-based and daily schedules at the same local time across DST', () => {
    const sat = utc(2026, 3, 7, 14, 0); // Sat 09:00 EST, the day before DST starts
    const sun = utc(2026, 3, 8, 13, 0); // Sun 09:00 EDT
    assert.equal(computeNextRun(sat, interval('1d'), sat, NY), sun);
    assert.equal(computeNextRun(sat, interval('09:00'), sat, NY), sun);
    assert.equal(computeNextRun(sat, interval('1w'), sat, NY), utc(2026, 3, 14, 13, 0));
  });

  it('treats hours and minutes as elapsed time across DST', () => {
    const midnight = utc(2026, 3, 8, 5, 0); // Sun 00:00 EST
    assert.equal(computeNextRun(midnight, interval('6h'), midnight, NY), utc(2026, 3, 8, 11, 0)); // 07:00 EDT
  });

  it('initialNextRun prefers a future start', () => {
    const now = utc(2026, 5, 1);
    assert.equal(initialNextRun(utc(2026, 6, 1), interval('1d'), UTC, now), utc(2026, 6, 1));
    assert.equal(initialNextRun(utc(2026, 4, 1), null, UTC, now), null);
    assert.equal(initialNextRun(utc(2026, 4, 30, 12, 0), interval('1d'), UTC, now), utc(2026, 5, 1, 12, 0));
  });
});

describe('formatting', () => {
  it('formats in the configured timezone', () => {
    assert.equal(formatDateTime(utc(2026, 7, 1, 13, 0), NY), '07/01/2026 09:00 EDT');
    assert.equal(formatDateTime(utc(2026, 7, 1, 13, 0), UTC), '07/01/2026 13:00 UTC');
    assert.equal(formatInput(utc(2026, 1, 15, 14, 0), NY), '01/15 09:00');
  });

  it('validates timezone names', () => {
    assert.equal(isValidTimeZone(NY), true);
    assert.equal(isValidTimeZone('UTC'), true);
    assert.equal(isValidTimeZone('Mars/Olympus_Mons'), false);
  });
});
