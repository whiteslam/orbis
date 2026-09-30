import { test } from 'vitest';
import assert from 'node:assert/strict';
import { addDays, dayOfMonth, daysBetween, mondayOf, monthOf, weekday } from './dates.ts';

test('date arithmetic works on plain YYYY-MM-DD strings', () => {
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(daysBetween('2026-09-26', '2026-09-30'), 4);
  assert.equal(weekday('2026-09-30'), 3, 'a Wednesday');
  assert.equal(monthOf('2026-09-30'), '2026-09');
  assert.equal(dayOfMonth('2026-09-07'), 7);
  assert.equal(mondayOf('2026-09-30'), '2026-09-28');
  assert.equal(mondayOf('2026-09-27'), '2026-09-21', 'Sunday belongs to the week before');
});
