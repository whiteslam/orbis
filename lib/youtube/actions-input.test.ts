import { test } from 'vitest';
import assert from 'node:assert/strict';

import { readMove, readSchedule } from './input.ts';

const good = { postTime: '18:00', days: [1, 2, 3, 4, 5, 6, 7], timezone: 'Asia/Kolkata', paused: false };

test('readSchedule accepts Asia/Kolkata 18:00 on every day', () => {
  assert.deepEqual(readSchedule(good), good);
});

test('readSchedule refuses 24:00, a bad minute and a loose time', () => {
  for (const postTime of ['24:00', '18:60', '6:00', '18:00:00', '', 1800, null]) {
    assert.equal(readSchedule({ ...good, postTime }), null, String(postTime));
  }
});

test('readSchedule refuses an empty day list, day 0, day 8, fractions and non-lists', () => {
  for (const days of [[], [0], [8], [1.5], ['1'], 'all', null, [1, 2, 3, 4, 5, 6, 7, 1]]) {
    assert.equal(readSchedule({ ...good, days }), null, JSON.stringify(days));
  }
});

test('readSchedule sorts the days and drops repeats', () => {
  assert.deepEqual(readSchedule({ ...good, days: [5, 1, 5, 3] })?.days, [1, 3, 5]);
});

test('readSchedule refuses an unknown zone and accepts a real one', () => {
  for (const timezone of ['Mars/Olympus', '', 'IST', '+05:30', 42, null]) {
    assert.equal(readSchedule({ ...good, timezone }), null, String(timezone));
  }
  assert.equal(readSchedule({ ...good, timezone: 'America/New_York' })?.timezone, 'America/New_York');
  assert.equal(readSchedule({ ...good, timezone: 'UTC' })?.timezone, 'UTC');
});

test('readSchedule needs paused to be a boolean, and an object', () => {
  assert.equal(readSchedule({ ...good, paused: 'no' }), null);
  assert.equal(readSchedule({ ...good, paused: true })?.paused, true);
  for (const input of [null, undefined, 'x', [], 7]) assert.equal(readSchedule(input), null);
});

test('readSchedule returns only the four fields it checked', () => {
  assert.deepEqual(readSchedule({ ...good, holdUntil: '2030-01-01T00:00:00Z', extra: 1 }), good);
});

test('readMove accepts only -1 and 1', () => {
  assert.equal(readMove(-1), -1);
  assert.equal(readMove(1), 1);
  for (const value of [0, 2, -2, 1.5, '1', '-1', null, undefined, true]) assert.equal(readMove(value), null, String(value));
});
