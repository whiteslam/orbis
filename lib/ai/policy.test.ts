import { test } from 'vitest';
import assert from 'node:assert/strict';
import { attemptCostUsd, budgetConfig, budgetState, capAttempts, monthStartIso, orderCandidates, paidAffordable, personalDataGuarded, worstCaseCostUsd, type Priced } from './policy';

const free = (id: string, order: number): Priced => ({ id, order, paid: false, inputUsdPerMTok: 0, outputUsdPerMTok: 0 });
const haiku = (order = 5): Priced => ({ id: 'haiku', order, paid: true, inputUsdPerMTok: 1, outputUsdPerMTok: 5 });

test('cost is tokens times the registry price, and free models cost nothing', () => {
  assert.equal(attemptCostUsd({ inputTokens: 1_000_000, outputTokens: 200_000 }, haiku()), 2);
  assert.equal(attemptCostUsd({ inputTokens: 5_000, outputTokens: 500 }, free('groq', 1)), 0);
  assert.equal(attemptCostUsd(null, haiku()), 0);
});
test('the worst case assumes every allowed output token is used', () => {
  // 4,000 characters is about 1,000 tokens.
  assert.equal(worstCaseCostUsd(4_000, 1_000, haiku()), 0.001 + 0.005);
});

test('budget comes from the environment, with ₹300 and fallback-only paid use by default', () => {
  assert.deepEqual(budgetConfig({}), { monthlyInr: 300, usdInr: 88, paidRouting: 'fallback' });
  assert.equal(budgetConfig({ ORBIS_AI_MONTHLY_BUDGET_INR: '500' }).paidRouting, 'quality');
  assert.equal(budgetConfig({ ORBIS_AI_MONTHLY_BUDGET_INR: '500', ORBIS_AI_PAID_ROUTING: 'fallback' }).paidRouting, 'fallback');
  assert.equal(budgetConfig({ ORBIS_AI_MONTHLY_BUDGET_INR: '0' }).monthlyInr, 0);
  assert.equal(budgetConfig({ ORBIS_AI_MONTHLY_BUDGET_INR: 'lots', ORBIS_AI_USD_INR: '-1' }).monthlyInr, 300);
  assert.equal(budgetConfig({ ORBIS_AI_USD_INR: '84.5' }).usdInr, 84.5);
});
test('the month is normal, then warning from 80%, then critical when the budget is spent', () => {
  const config = budgetConfig({});
  assert.equal(budgetState(0, config), 'normal');
  assert.equal(budgetState((240 / 88) - 0.01, config), 'normal');
  assert.equal(budgetState(240 / 88, config), 'warning');
  assert.equal(budgetState(300 / 88, config), 'critical');
  assert.equal(budgetState(0, budgetConfig({ ORBIS_AI_MONTHLY_BUDGET_INR: '0' })), 'critical');
});

const pool = [free('groq-a', 10), free('groq-b', 20), haiku()];
const ids = (list: Priced[]) => list.map((item) => item.id);

test('₹300 mode: free models first, the paid model only after they fail', () => {
  assert.deepEqual(ids(orderCandidates(pool, { feature: 'ask_orbis', paidRouting: 'fallback', state: 'normal' })), ['groq-a', 'groq-b', 'haiku']);
});
test('₹500 mode: quality features try the paid model first', () => {
  assert.deepEqual(ids(orderCandidates(pool, { feature: 'health_plan', paidRouting: 'quality', state: 'normal' })), ['haiku', 'groq-a', 'groq-b']);
  assert.deepEqual(ids(orderCandidates(pool, { feature: 'home_brief', paidRouting: 'quality', state: 'normal' })), ['groq-a', 'groq-b', 'haiku']);
});
test('a warning month keeps paid models as a last resort, even in ₹500 mode', () => {
  assert.deepEqual(ids(orderCandidates(pool, { feature: 'health_plan', paidRouting: 'quality', state: 'warning' })), ['groq-a', 'groq-b', 'haiku']);
});
test('a spent budget leaves only free models', () => {
  assert.deepEqual(ids(orderCandidates(pool, { feature: 'ask_orbis', paidRouting: 'quality', state: 'critical' })), ['groq-a', 'groq-b']);
});
test('heads-ups never pay: Orbis’s own wording is good enough', () => {
  assert.deepEqual(ids(orderCandidates(pool, { feature: 'headsups', paidRouting: 'quality', state: 'normal' })), ['groq-a', 'groq-b']);
});

test('the attempt cap never squeezes out the paid fallback', () => {
  const many = [free('a', 1), free('b', 2), free('c', 3), free('d', 4), free('e', 5), haiku(9)];
  assert.deepEqual(ids(capAttempts(many, 4)), ['a', 'b', 'c', 'haiku']);
  assert.deepEqual(ids(capAttempts([haiku(0), ...many.slice(0, 5)], 4)), ['haiku', 'a', 'b', 'c']);
  assert.deepEqual(ids(capAttempts([free('a', 1), free('b', 2)], 4)), ['a', 'b']);
});
test('a paid attempt is only made when its worst case fits what is left of the month', () => {
  const config = budgetConfig({});
  // ₹300 at 88 is about $3.41; this request could cost at most $0.006.
  assert.equal(paidAffordable({ promptChars: 4_000, maxTokens: 1_000 }, haiku(), 3, config), true);
  assert.equal(paidAffordable({ promptChars: 4_000, maxTokens: 1_000 }, haiku(), 3.405, config), false);
});

test('the budget month starts at midnight on the 1st in India', () => {
  assert.equal(monthStartIso(new Date('2026-10-15T10:00:00Z')), '2026-09-30T18:30:00.000Z');
  // 1 Oct 02:00 in India is still 30 Sep in UTC, but already October's budget.
  assert.equal(monthStartIso(new Date('2026-09-30T20:30:00Z')), '2026-09-30T18:30:00.000Z');
  assert.equal(monthStartIso(new Date('2026-01-01T00:00:00Z')), '2025-12-31T18:30:00.000Z');
});

const DENY = { provider: { data_collection: 'deny', only: ['anthropic'], allow_fallbacks: false } };
test('personal data reaches an OpenRouter model only when the request tells it to deny data collection', () => {
  assert.equal(personalDataGuarded('https://openrouter.ai/api/v1', DENY), true);
  assert.equal(personalDataGuarded('https://openrouter.ai/api/v1', {}), false);
  assert.equal(personalDataGuarded('https://openrouter.ai/api/v1', { provider: { data_collection: 'allow' } }), false);
  assert.equal(personalDataGuarded('https://openrouter.ai/api/v1', { reasoning: { effort: 'low' } }), false);
});
test('other providers keep their own registry stance', () => {
  assert.equal(personalDataGuarded('https://api.groq.com/openai/v1', {}), true);
  assert.equal(personalDataGuarded('https://api.anthropic.com', {}), true);
});

test('a Jev verdict overrides the mode for that one request', () => {
  // ₹300 mode, but Jev says the question needs reasoning: Claude first.
  assert.deepEqual(ids(orderCandidates(pool, { feature: 'ask_orbis', paidRouting: 'fallback', state: 'normal', escalate: true })), ['haiku', 'groq-a', 'groq-b']);
  // ₹500 mode, but a simple lookup: free first, Claude only if they fail.
  assert.deepEqual(ids(orderCandidates(pool, { feature: 'ask_orbis', paidRouting: 'quality', state: 'normal', escalate: false })), ['groq-a', 'groq-b', 'haiku']);
});
test('a Jev verdict never outranks the budget or a free-only feature', () => {
  assert.deepEqual(ids(orderCandidates(pool, { feature: 'ask_orbis', paidRouting: 'fallback', state: 'warning', escalate: true })), ['groq-a', 'groq-b', 'haiku']);
  assert.deepEqual(ids(orderCandidates(pool, { feature: 'ask_orbis', paidRouting: 'quality', state: 'critical', escalate: true })), ['groq-a', 'groq-b']);
  assert.deepEqual(ids(orderCandidates(pool, { feature: 'headsups', paidRouting: 'quality', state: 'normal', escalate: true })), ['groq-a', 'groq-b']);
});
