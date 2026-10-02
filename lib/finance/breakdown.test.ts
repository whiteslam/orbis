import { test } from 'vitest';
import assert from 'node:assert/strict';
import { monthBreakdown, summariseOwnInvestments } from './breakdown.ts';

const row = (amount: number, category: string, direction = 'expense', occurred_at = '2026-09-10T06:00:00Z', currency = 'INR') =>
  ({ amount, currency, direction, category, occurred_at });

test('money moved into an investment is not counted as spent', () => {
  const rows = [row(2_000, 'Groceries'), row(10_000, 'FD'), row(5_000, 'SIP / Mutual fund'), row(50_000, 'Salary', 'income')];
  const month = monthBreakdown(rows, new Map([['INR', 2_000]]), 2026, 9)!;
  assert.equal(month.spent, 2_000);
  assert.equal(month.invested, 15_000);
  assert.equal(month.received, 50_000);
  assert.deepEqual(month.categories, [{ category: 'Groceries', amount: 2_000 }]);
  assert.equal(month.daily[9].amount, 2_000);
});

test('own investments are summed by category, largest first', () => {
  const own = summariseOwnInvestments([
    row(12_000, 'FD', 'expense', '2026-08-01T00:00:00Z'),
    row(5_000, 'SIP / Mutual fund', 'expense', '2026-08-05T00:00:00Z'),
    row(5_000, 'SIP / Mutual fund', 'expense', '2026-09-05T00:00:00Z'),
    row(1_000, 'Groceries'),
  ]);
  assert.equal(own.currency, 'INR');
  assert.equal(own.total, 22_000);
  assert.deepEqual(own.categories.map((entry) => [entry.category, entry.amount, entry.count]), [['FD', 12_000, 1], ['SIP / Mutual fund', 10_000, 2]]);
  assert.equal(own.categories[1].lastAt, '2026-09-05T00:00:00Z');
});

test('no investments gives an empty summary', () => {
  assert.deepEqual(summariseOwnInvestments([]), { currency: 'INR', total: 0, categories: [] });
});
