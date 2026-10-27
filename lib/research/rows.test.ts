import { test } from 'vitest';
import assert from 'node:assert/strict';
import { effectiveStatus, readEvent, readRun, readSettings, readSettlement } from './rows';
import { DEFAULT_RESEARCH_SETTINGS } from './types';

const baseRun = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: '22222222-2222-4222-8222-222222222222',
  ticker: 'RELIANCE.NS',
  symbol: 'RELIANCE',
  exchange: 'NSE',
  trade_date: '2026-10-27',
  source: 'manual',
  status: 'done',
  portfolio_context: { currency: 'INR', cash: null, positions: [] },
  config: {},
  decision: { rating: 'Overweight', summary: 'Add slowly.', thesis: 'Margins.', priceTarget: 3100, horizon: '3-6 months', entry: 2900, stop: 2700, sizing: '5%', trader: 'Buy' },
  cost_usd: '0.42',
  input_tokens: 120000,
  output_tokens: 9000,
  tokens: 129000,
  error: null,
  dispatched_at: '2026-10-27T04:00:00Z',
  started_at: '2026-10-27T04:01:00Z',
  finished_at: '2026-10-27T04:08:00Z',
  created_at: '2026-10-27T04:00:00Z',
};

test('a run row is read with its decision and numbers', () => {
  const run = readRun(baseRun);
  assert.ok(run);
  assert.equal(run.ticker, 'RELIANCE.NS');
  assert.equal(run.costUsd, 0.42);
  assert.equal(run.decision?.rating, 'Overweight');
  assert.equal(run.decision?.priceTarget, 3100);
});

test('a run with a status Orbis does not know is dropped', () => {
  assert.equal(readRun({ ...baseRun, status: 'exploded' }), null);
  assert.equal(readRun({ ...baseRun, ticker: 42 }), null);
});

test('a decision with an unknown rating reads as no decision', () => {
  assert.equal(readRun({ ...baseRun, decision: { ...baseRun.decision, rating: 'Moon' } })?.decision, null);
  // REVIEW is the upstream signal for "no parseable rating": kept, so the screen can say so.
  assert.equal(readRun({ ...baseRun, decision: { ...baseRun.decision, rating: 'REVIEW' } })?.decision?.rating, 'REVIEW');
});

test('events and settlements are shape-checked', () => {
  assert.deepEqual(readEvent({ seq: 3, agent: 'bull', kind: 'turn', content: 'Growth is strong.', at: '2026-10-27T04:03:00Z' }), {
    seq: 3, agent: 'bull', kind: 'turn', content: 'Growth is strong.', at: '2026-10-27T04:03:00Z',
  });
  assert.equal(readEvent({ seq: 3, agent: 'oracle', kind: 'turn', content: 'x', at: 'x' }), null);
  const settled = readSettlement({ run_id: baseRun.id, ticker: 'RELIANCE.NS', trade_date: '2026-10-20', benchmark: '^NSEI', holding_days: 5, return_pct: '2.1', benchmark_pct: '0.6', alpha_pct: '1.5', reflection: 'Right call.', settled_at: '2026-10-28T00:00:00Z' });
  assert.equal(settled?.alphaPct, 1.5);
  assert.equal(readSettlement({ run_id: baseRun.id }), null);
});

test('settings merge over the defaults, and nothing saved means the defaults', () => {
  assert.deepEqual(readSettings(null), DEFAULT_RESEARCH_SETTINGS);
  const read = readSettings({ enabled: true, weekly_enabled: true, weekly_top_n: 3, deep_model: null, quick_model: 'anthropic/claude-haiku-5.5', run_token_cap: 400000, monthly_run_cap: 10 });
  assert.equal(read.weeklyEnabled, true);
  assert.equal(read.weeklyTopN, 3);
  assert.equal(read.deepModel, DEFAULT_RESEARCH_SETTINGS.deepModel);
  assert.equal(read.monthlyRunCap, 10);
  // The weekly run is off until the owner turns it on.
  assert.equal(DEFAULT_RESEARCH_SETTINGS.weeklyEnabled, false);
});

test('a run nobody picked up, or one that never finished, reads as failed', () => {
  const queued = readRun({ ...baseRun, status: 'queued', started_at: null, finished_at: null, decision: null, created_at: '2026-10-27T04:00:00Z' });
  assert.ok(queued);
  assert.equal(effectiveStatus(queued, new Date('2026-10-27T04:10:00Z')), 'queued');
  assert.equal(effectiveStatus(queued, new Date('2026-10-27T04:46:00Z')), 'failed');
  const running = readRun({ ...baseRun, status: 'running', finished_at: null, decision: null, started_at: '2026-10-27T04:01:00Z' });
  assert.ok(running);
  assert.equal(effectiveStatus(running, new Date('2026-10-27T05:00:00Z')), 'running');
  assert.equal(effectiveStatus(running, new Date('2026-10-27T06:02:00Z')), 'failed');
  assert.equal(effectiveStatus(readRun(baseRun)!, new Date('2030-01-01T00:00:00Z')), 'done');
});
