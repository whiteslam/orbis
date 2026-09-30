import { test } from 'vitest';
import assert from 'node:assert/strict';
import { addDays } from '../dates.ts';
import { bigSpend, categoryHot, loggingGap, type Expense } from './money.ts';

const TODAY = '2026-09-30';
let next = 0;
const spend = (localDate: string, amount: number, category: string | null = 'Food', extra: Partial<Expense> = {}): Expense => ({
  id: `e${next++}`, amount, currency: 'INR', category, merchant: 'Swiggy', localDate, ...extra,
});

// Five ordinary food spends of ~400 over the summer.
const usualFood = [10, 20, 30, 40, 50].map((back) => spend(addDays(TODAY, -back), 400));

test('big spend: fires on a recent spend at least 3x the category median', () => {
  const findings = bigSpend({ today: TODAY, expenses: [...usualFood, spend(TODAY, 1200)] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'money.big_spend');
  assert.equal(findings[0].urgency, 'urgent');
  assert.deepEqual(findings[0].action, { type: 'review_category', category: 'Food' });
  assert.equal(findings[0].evidence.usual, 400);
});

test('big spend: a near miss does not fire', () => {
  assert.equal(bigSpend({ today: TODAY, expenses: [...usualFood, spend(TODAY, 1190)] }).length, 0);
});

test('big spend: needs five earlier spends in the category', () => {
  assert.equal(bigSpend({ today: TODAY, expenses: [...usualFood.slice(0, 4), spend(TODAY, 5000)] }).length, 0);
});

test('big spend: only today and yesterday count, so the first scan does not dig up old spends', () => {
  assert.equal(bigSpend({ today: TODAY, expenses: [...usualFood, spend(addDays(TODAY, -2), 5000)] }).length, 0);
});

test('big spend: dominant currency only', () => {
  const findings = bigSpend({ today: TODAY, expenses: [...usualFood, spend(TODAY, 1500, 'Food', { currency: 'USD' })] });
  assert.equal(findings.length, 0, 'a USD spend is not compared with INR food');
});

test('big spend: the dedupe key is stable across runs', () => {
  const expenses = [...usualFood, spend(TODAY, 1200)];
  assert.equal(bigSpend({ today: TODAY, expenses })[0].dedupeKey, bigSpend({ today: TODAY, expenses })[0].dedupeKey);
});

// Three earlier months of ~3000 food by the 20th, and this month 4000 by the 20th.
const monthly = (month: string, amount: number) => [spend(`${month}-05`, amount / 2), spend(`${month}-15`, amount / 2)];
const history = [...monthly('2026-06', 3000), ...monthly('2026-07', 3000), ...monthly('2026-08', 3000)];

test('category hot: fires at 1.3x the usual month-to-date', () => {
  const findings = categoryHot({ today: '2026-09-20', expenses: [...history, ...monthly('2026-09', 4000)] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].dedupeKey, 'money.category_hot:Food:2026-09');
  assert.equal(findings[0].evidence.thisMonth, 4000);
  assert.equal(findings[0].evidence.usual, 3000);
});

test('category hot: a near miss does not fire', () => {
  assert.equal(categoryHot({ today: '2026-09-20', expenses: [...history, ...monthly('2026-09', 3800)] }).length, 0);
});

test('category hot: waits until the 10th', () => {
  const early = [...history, spend('2026-09-02', 9000)];
  assert.equal(categoryHot({ today: '2026-09-09', expenses: early }).length, 0);
  assert.equal(categoryHot({ today: '2026-09-10', expenses: early }).length, 1);
});

test('category hot: needs spending in each of the three months before', () => {
  const partial = [...monthly('2026-07', 3000), ...monthly('2026-08', 3000), ...monthly('2026-09', 9000)];
  assert.equal(categoryHot({ today: '2026-09-20', expenses: partial }).length, 0);
});

// Logged every day from 6 to 25 September (20 of the 30 days up to the 25th), then nothing.
const habitual = Array.from({ length: 20 }, (_, index) => spend(addDays('2026-09-25', -index), 100, 'Food'));

test('logging gap: fires after 4 quiet days for someone who logs most days', () => {
  const findings = loggingGap({ today: TODAY, expenses: habitual });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].dedupeKey, 'money.logging_gap:2026-09-25');
  assert.deepEqual(findings[0].action, { type: 'open_spending_entry' });
});

test('logging gap: three quiet days is not a gap', () => {
  assert.equal(loggingGap({ today: '2026-09-28', expenses: habitual }).length, 0);
});

test('logging gap: someone who rarely logs is not nagged', () => {
  const rare = [spend('2026-09-01', 100), spend('2026-09-10', 100), spend('2026-09-20', 100)];
  assert.equal(loggingGap({ today: TODAY, expenses: rare }).length, 0);
});

test('money checks: nothing at all is nothing to say', () => {
  assert.deepEqual([...bigSpend({ today: TODAY, expenses: [] }), ...categoryHot({ today: TODAY, expenses: [] }), ...loggingGap({ today: TODAY, expenses: [] })], []);
});

test('logging gap: someone who stopped a month ago is not reminded forever', () => {
  assert.equal(loggingGap({ today: addDays('2026-09-25', 30), expenses: habitual }).length, 1);
  assert.equal(loggingGap({ today: addDays('2026-09-25', 31), expenses: habitual }).length, 0);
});
