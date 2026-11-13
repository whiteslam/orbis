import { beforeAll, test } from 'vitest';
import assert from 'node:assert/strict';
import { pauseUntil } from './pause';

// The phone's own zone decides "tomorrow". Node picks up a TZ change at run time.
beforeAll(() => {
  process.env.TZ = 'Asia/Kolkata';
});

test('"For an hour" adds 3,600,000 ms', () => {
  const now = new Date('2026-11-13T10:15:00+05:30');
  assert.equal(pauseUntil('hour', now), now.getTime() + 3_600_000);
});

test('"Until tomorrow" at 23:30 gives 06:00 the next day', () => {
  const now = new Date('2026-11-13T23:30:00+05:30');
  assert.equal(pauseUntil('tomorrow', now), new Date('2026-11-14T06:00:00+05:30').getTime());
});

test('"Until tomorrow" at 01:00 gives 06:00 on the next calendar date, not the same morning', () => {
  const now = new Date('2026-11-14T01:00:00+05:30');
  assert.equal(pauseUntil('tomorrow', now), new Date('2026-11-15T06:00:00+05:30').getTime());
});

test('"Until tomorrow" crosses a month end', () => {
  const now = new Date('2026-11-30T20:00:00+05:30');
  assert.equal(pauseUntil('tomorrow', now), new Date('2026-12-01T06:00:00+05:30').getTime());
});

test('"Until I turn it back on" is -1', () => {
  assert.equal(pauseUntil('forever', new Date('2026-11-13T10:15:00+05:30')), -1);
});
