import { test } from 'vitest';
import assert from 'node:assert/strict';
import { budgetConfig } from './policy';
import { summariseUsage, type UsageRow } from './usage';

const row = (overrides: Partial<UsageRow>): UsageRow => ({
  providerId: 'groq', modelId: 'gpt-oss', outcome: 'succeeded', attempt: 1, durationMs: 1_000, inputTokens: 1_000, outputTokens: 100, costUsd: 0, ...overrides,
});

const config = budgetConfig({});
// 15 Oct, about 46% of the way through October in India.
const now = new Date('2026-10-15T06:30:00Z');

test('splits free and paid calls, with tokens and cost', () => {
  const summary = summariseUsage([
    row({}),
    row({ outcome: 'timeout', inputTokens: null, outputTokens: null, durationMs: 15_000 }),
    row({ providerId: 'anthropic', modelId: 'claude-haiku-4-5', costUsd: 0.01, inputTokens: 5_000, outputTokens: 1_000 }),
  ], ['anthropic/claude-haiku-4-5'], config, now);
  assert.deepEqual(summary.free, { calls: 2, failed: 1, tokens: 1_100 });
  assert.deepEqual(summary.paid, { calls: 1, failed: 0, tokens: 6_000 });
  assert.equal(summary.spentInr, 0.88);
});
test('a fallback is an answer that came from a second or later model', () => {
  const summary = summariseUsage([row({ attempt: 1 }), row({ attempt: 2 }), row({ attempt: 3, outcome: 'failed' })], [], config, now);
  assert.equal(summary.fallbacks, 1);
});
test('average latency counts answered calls only', () => {
  const summary = summariseUsage([row({ durationMs: 1_000 }), row({ durationMs: 3_000 }), row({ outcome: 'timeout', durationMs: 15_000 })], [], config, now);
  assert.equal(summary.averageLatencyMs, 2_000);
});
test('projects the month from the pace so far, and reports the budget state', () => {
  const summary = summariseUsage([row({ providerId: 'anthropic', modelId: 'claude-haiku-4-5', costUsd: 1 })], ['anthropic/claude-haiku-4-5'], config, now);
  assert.equal(summary.budgetInr, 300);
  assert.equal(summary.spentInr, 88);
  assert.ok(summary.projectedInr > 180 && summary.projectedInr < 200, String(summary.projectedInr));
  assert.equal(summary.state, 'normal');
});
test('an empty month is all zeros, not NaN', () => {
  const summary = summariseUsage([], [], config, now);
  assert.equal(summary.averageLatencyMs, null);
  assert.equal(summary.projectedInr, 0);
  assert.equal(summary.free.calls + summary.paid.calls, 0);
});
test('the budget line uses the whole bill when given it, while calls stay the viewer’s own', () => {
  const summary = summariseUsage([row({ providerId: 'anthropic', modelId: 'claude-haiku-4-5', costUsd: 0.5 })], ['anthropic/claude-haiku-4-5'], config, now, 2);
  assert.equal(summary.paid.calls, 1);
  assert.equal(summary.spentInr, 176);
});

test('one provider can host free and paid models: each call is judged by its own model and cost', () => {
  const summary = summariseUsage([
    row({ providerId: 'openrouter', modelId: 'google/gemma-4-31b-it:free' }),
    row({ providerId: 'openrouter', modelId: 'anthropic/claude-haiku-4.5', outcome: 'timeout', costUsd: null }),
    // Jev is not in the model registry, but it costs money.
    row({ providerId: 'openrouter', modelId: 'typesafe/jev-1.13', costUsd: 0.000015 }),
  ], ['openrouter/anthropic/claude-haiku-4.5'], config, now);
  assert.equal(summary.free.calls, 1);
  assert.equal(summary.paid.calls, 2);
});
