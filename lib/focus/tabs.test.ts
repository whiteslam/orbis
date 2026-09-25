import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeFinanceFocus, composeFinanceRows } from './finance.ts';
import { composeHealthFocus, composeHealthRows } from './health.ts';
import { composeInvestFocus, composeInvestRows } from './invest.ts';
import type { FinanceSummary } from '../finance/types.ts';
import type { GoalsSummary } from '../goals/types.ts';
import type { StepsSummary } from '../health/types.ts';
import type { PortfolioAnalysis } from '../invest/analysis.ts';

const NOW = new Date('2026-09-24T14:30:00Z'); // 8pm IST on the 24th

const finance = (overrides: Partial<FinanceSummary> = {}): FinanceSummary => ({
  databaseReady: true,
  loadError: false,
  connection: { email: 'you@example.com', status: 'connected', lastSyncAt: '2026-09-24T09:00:00Z' },
  pendingCandidateCount: 0,
  unparsedCandidateCount: 0,
  reviewCandidates: [],
  transactions: [],
  monthlyExpenses: [],
  month: null,
  ...overrides,
});

const month = (overrides: Partial<NonNullable<FinanceSummary['month']>> = {}) => ({
  currency: 'INR',
  year: 2026,
  month: 9,
  spent: 24_000,
  received: 0,
  categories: [{ category: 'Food', amount: 9_000 }, { category: 'Transport', amount: 4_000 }],
  daily: [],
  ...overrides,
});

const steps = (overrides: Partial<StepsSummary> = {}): StepsSummary => ({
  databaseReady: true, loadError: false, days: [], latest: null,
  average7: null, average30: null, previous30: null, best: null, lastImport: null,
  ...overrides,
});

const goals = (overrides: Partial<GoalsSummary> = {}): GoalsSummary => ({ databaseReady: true, goals: [], habits: [], ...overrides });

const analysis = (overrides: Partial<PortfolioAnalysis> = {}): PortfolioAnalysis => ({
  positions: [], total: 0, invested: 0, allLive: false, livePnl: null, liveInvested: 0,
  byClass: [], largest: null, effectiveHoldings: 0,
  concentration: 'good', diversification: 'good', mix: 'good',
  ...overrides,
});

// ── Finance ──────────────────────────────────────────────────────────────────

test('finance leads with the month once there is spending to report', () => {
  const focus = composeFinanceFocus({ summary: finance({ month: month() }), now: NOW });
  assert.equal(focus.id, 'month-so-far');
  assert.match(focus.headline, /₹24,000 spent so far/);
  assert.match(focus.body, /a day/);
  assert.match(focus.body, /Food is the largest share at 38%/);
  assert.match(focus.body, /24 days in/);
});

test('finance puts alerts and a broken connection ahead of the month', () => {
  const alerts = composeFinanceFocus({ summary: finance({ month: month(), pendingCandidateCount: 2, unparsedCandidateCount: 1 }), now: NOW });
  assert.equal(alerts.id, 'review-alerts');
  assert.match(alerts.body, /1 alert could not be parsed/);

  const broken = composeFinanceFocus({
    summary: finance({ month: month(), pendingCandidateCount: 2, connection: { email: 'you@example.com', status: 'reconnect_required', lastSyncAt: null } }),
    now: NOW,
  });
  assert.equal(broken.id, 'gmail-reconnect');
});

test('finance rows report a daily average only when there is a month to divide', () => {
  const withMonth = composeFinanceRows({ summary: finance({ month: month(), monthlyExpenses: [{ currency: 'INR', amount: 24_000 }] }), now: NOW });
  assert.equal(withMonth.find((row) => row.label === 'Daily average')?.value, '₹1,000');
  assert.equal(withMonth.find((row) => row.label === 'Largest category')?.value, 'Food · ₹9,000');

  const without = composeFinanceRows({ summary: finance(), now: NOW });
  assert.equal(without.find((row) => row.label === 'Daily average')?.empty, true);
});

// ── Health ───────────────────────────────────────────────────────────────────

test('health reads the step trend before asking for another upload', () => {
  const focus = composeHealthFocus({
    steps: steps({ average30: 6_400, previous30: 8_000, latest: { date: '2026-09-23', steps: 5_100 } }),
    goals: goals(), documentCount: 0, planCount: 0, libraryState: 'ready',
  });
  assert.equal(focus.id, 'steps-falling');
  assert.match(focus.headline, /down 20%/);
});

test('health asks for a document, then a plan, then reports on goals', () => {
  const base = { steps: steps(), goals: goals(), libraryState: 'ready' as const };
  assert.equal(composeHealthFocus({ ...base, documentCount: 0, planCount: 0 }).id, 'upload-document');
  assert.equal(composeHealthFocus({ ...base, documentCount: 2, planCount: 0 }).id, 'no-plan');

  const withGoal = composeHealthFocus({
    ...base,
    goals: goals({ goals: [{ id: '1', title: 'Run 100 km', current: 40, target: 100, unit: 'km', dueDate: '2026-12-01' }] }),
    documentCount: 2, planCount: 1,
  });
  assert.equal(withGoal.id, 'goal-progress');
  assert.match(withGoal.headline, /is at 40%/);
});

test('health rows distinguish missing step data from a zero day', () => {
  const rows = composeHealthRows({ steps: steps(), goals: goals(), documentCount: 0, planCount: 0 });
  assert.equal(rows.find((row) => row.label === 'Steps today')?.value, 'Not imported');
  assert.equal(rows.find((row) => row.label === '30 days vs before')?.empty, true);

  const filled = composeHealthRows({ steps: steps({ latest: { date: '2026-09-24', steps: 0 }, average30: 9_000, previous30: 8_000 }), goals: goals(), documentCount: 1, planCount: 1 });
  assert.equal(filled.find((row) => row.label === 'Steps today')?.value, '0');
  assert.equal(filled.find((row) => row.label === '30 days vs before')?.value, '+13%');
});

// ── Invest ───────────────────────────────────────────────────────────────────

test('invest holds the loading line until the accounts have answered', () => {
  const focus = composeInvestFocus({ analysis: analysis(), loaded: false, failures: [], connected: true });
  assert.equal(focus.id, 'loading');

  // Nothing linked yet reads as a setup step, not as an empty portfolio.
  const fresh = composeInvestFocus({ analysis: analysis(), loaded: true, failures: [], connected: false });
  assert.equal(fresh.id, 'not-connected');
});

test('invest names the account that failed rather than blaming the portfolio', () => {
  const focus = composeInvestFocus({
    analysis: analysis(),
    loaded: true,
    connected: true,
    failures: [{ name: 'Groww', message: 'Groww is not responding.' }],
  });
  assert.equal(focus.id, 'account-error');
  assert.match(focus.headline, /Groww could not be reached/);
});

test('invest warns about concentration before reporting the gain', () => {
  const focus = composeInvestFocus({
    analysis: analysis({
      positions: [{ key: 'a', name: 'HDFC Bank', broker: 'groww', assetClass: 'Stocks', value: 300_000, invested: 250_000, live: true }],
      total: 500_000, invested: 400_000, livePnl: 50_000, liveInvested: 250_000, effectiveHoldings: 1.8,
      largest: { name: 'HDFC Bank', share: 0.6 },
    }),
    loaded: true, failures: [], connected: true,
  });
  assert.equal(focus.id, 'concentration');
  assert.match(focus.headline, /HDFC Bank is 60%/);
  assert.match(focus.body, /about 1.8 independent ones/);
});

test('invest says plainly when the total is only what the holdings cost', () => {
  const focus = composeInvestFocus({
    analysis: analysis({
      positions: [{ key: 'a', name: 'GOLDBEES', broker: 'groww', assetClass: 'Gold & silver', value: 100_000, invested: 100_000, live: false }],
      total: 100_000, invested: 100_000, byClass: [{ assetClass: 'Gold & silver', value: 100_000, share: 1 }], largest: { name: 'GOLDBEES', share: 1 },
    }),
    loaded: true, failures: [], connected: true,
  });
  // A single holding is concentrated by definition, so that rule speaks first.
  assert.equal(focus.id, 'concentration');

  const spread = composeInvestFocus({
    analysis: analysis({
      positions: [{ key: 'a', name: 'GOLDBEES', broker: 'groww', assetClass: 'Gold & silver', value: 60_000, invested: 60_000, live: false }],
      total: 200_000, invested: 200_000, byClass: [{ assetClass: 'Gold & silver', value: 60_000, share: 0.3 }], largest: { name: 'GOLDBEES', share: 0.3 },
    }),
    loaded: true, failures: [], connected: true,
  });
  assert.equal(spread.id, 'cost-basis');
  assert.match(spread.body, /No live price came back/);
});

test('invest rows name what is unknown rather than showing a zero', () => {
  const rows = composeInvestRows({ analysis: analysis() });
  assert.equal(rows.find((row) => row.label === 'Invested')?.value, '—');
  assert.equal(rows.find((row) => row.label === 'Unrealised')?.value, 'No live prices');
  assert.equal(rows.find((row) => row.label === 'Holdings')?.value, 'None');
  assert.equal(rows.find((row) => row.label === 'Largest position')?.value, 'None');
});

// The portfolio total is the Invest screen's hero figure, so these rows must not
// repeat it — the old "Total value" row said the same number twice.
test('invest rows leave the total to the hero figure', () => {
  const rows = composeInvestRows({ analysis: analysis() });
  assert.equal(rows.find((row) => row.label === 'Total value'), undefined);
});
