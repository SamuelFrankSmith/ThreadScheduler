import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeNextRun, describeInterval, initialNextRun, parseDateTime, parseInterval, type Interval } from './time.js';

const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);

function interval(s: string): Interval {
  const r = parseInterval(s);
  assert.ok(r.ok, `expected ${s} to parse`);
  return r.value;
}

describe('parseDateTime', () => {
  const now = utc(2026, 9, 26, 12, 0);

  it('uses the current year when in the future', () => {
    assert.deepEqual(parseDateTime('10/01 18:30', now), { ok: true, value: utc(2026, 10, 1, 18, 30) });
  });

  it('rolls to next year when already past', () => {
    assert.deepEqual(parseDateTime('01/15 08:00', now), { ok: true, value: utc(2027, 1, 15, 8, 0) });
  });

  it('rolls 02/29 forward to the next leap year', () => {
    assert.deepEqual(parseDateTime('02/29 00:00', now), { ok: true, value: utc(2028, 2, 29) });
  });

  it('rejects invalid input', () => {
    for (const bad of ['02/30 10:00', '13/01 10:00', '10/01 24:00', '10/01 10:60', '2026-10-01 10:00', '10/01']) {
      assert.equal(parseDateTime(bad, now).ok, false, bad);
    }
  });
});

describe('parseInterval', () => {
  it('parses durations', () => {
    assert.equal(describeInterval(interval('1d')), 'every 1 day');
    assert.equal(describeInterval(interval('6hr')), 'every 6 hours');
    assert.equal(describeInterval(interval('1y')), 'every 1 year');
    assert.equal(describeInterval(interval('1d6h')), 'every 1 day 6 hours');
    assert.equal(describeInterval(interval('2w 30m')), 'every 2 weeks 30 minutes');
    assert.equal(describeInterval(interval('1mo')), 'every 1 month');
  });

  it('parses daily times', () => {
    assert.deepEqual(interval('18:30hr'), { kind: 'daily', hour: 18, minute: 30 });
    assert.deepEqual(interval('7:05'), { kind: 'daily', hour: 7, minute: 5 });
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
    assert.equal(computeNextRun(start, interval('6h'), start), utc(2026, 1, 1, 15, 0));
    assert.equal(computeNextRun(start, interval('6h'), utc(2026, 1, 3, 10, 0)), utc(2026, 1, 3, 15, 0));
  });

  it('clamps month ends without drifting', () => {
    const start = utc(2026, 1, 31, 12, 0);
    assert.equal(computeNextRun(start, interval('1mo'), start), utc(2026, 2, 28, 12, 0));
    assert.equal(computeNextRun(start, interval('1mo'), utc(2026, 2, 28, 12, 0)), utc(2026, 3, 31, 12, 0));
    assert.equal(computeNextRun(start, interval('1y'), start), utc(2027, 1, 31, 12, 0));
  });

  it('runs daily at the configured time', () => {
    const start = utc(2026, 5, 1, 9, 0);
    assert.equal(computeNextRun(start, interval('18:30hr'), start), utc(2026, 5, 1, 18, 30));
    assert.equal(computeNextRun(start, interval('18:30hr'), utc(2026, 5, 1, 18, 30)), utc(2026, 5, 2, 18, 30));
  });

  it('initialNextRun prefers a future start', () => {
    const now = utc(2026, 5, 1);
    assert.equal(initialNextRun(utc(2026, 6, 1), interval('1d'), now), utc(2026, 6, 1));
    assert.equal(initialNextRun(utc(2026, 4, 1), null, now), null);
    assert.equal(initialNextRun(utc(2026, 4, 30, 12, 0), interval('1d'), now), utc(2026, 5, 1, 12, 0));
  });
});
