import { test } from 'vitest';
import assert from 'node:assert/strict';
import { dispatchConfig, dispatchRuns, type DispatchConfig } from './dispatch';
import { cancelRun, istMonthStart, queueRuns, type QueueDb } from './queue';
import { deskHoldings, portfolioContextFor } from './context';
import { DEFAULT_RESEARCH_SETTINGS } from './types';
import type { BrokerPortfolio } from '@/lib/invest/types';

const CONFIG: DispatchConfig = { token: 'github_pat_test', repo: 'owner/orbis-research-worker', workflow: 'research-desk.yml', ref: 'main' };

type Call = { url: string; init: RequestInit };
function fakeFetch(responses: Array<number | 'throw'>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift() ?? 204;
    if (next === 'throw') throw new TypeError('fetch failed');
    return new Response(next === 204 ? null : '{}', { status: next });
  };
  return { calls, fetchImpl: fetchImpl as typeof fetch };
}

function fakeDb(seed: { monthCount?: number; active?: string[]; status?: string } = {}) {
  const rows: Array<Record<string, unknown>> = [];
  const failed: Array<{ id: string; message: string }> = [];
  const dispatched: string[] = [];
  let status = seed.status ?? 'queued';
  const db: QueueDb = {
    countRunsSince: async () => seed.monthCount ?? 0,
    activeTickers: async () => seed.active ?? [],
    insertRun: async (row) => {
      rows.push(row);
      return `run-${rows.length}`;
    },
    markDispatched: async (ids) => { dispatched.push(...ids); },
    markFailed: async (ids, message) => { for (const id of ids) failed.push({ id, message }); },
    cancel: async () => {
      if (status !== 'queued' && status !== 'running') return false;
      status = 'cancelled';
      return true;
    },
  };
  return { db, rows, failed, dispatched };
}

const target = { ok: true as const, ticker: 'RELIANCE.NS', exchange: 'NSE' as const, symbol: 'RELIANCE' };
const base = {
  userId: 'user-1',
  portfolio: { currency: 'INR' as const, cash: null, positions: [] },
  settings: DEFAULT_RESEARCH_SETTINGS,
  source: 'manual' as const,
  now: new Date('2026-10-27T04:00:00Z'),
};

test('the dispatch config needs a token and an owner/name repo', () => {
  assert.equal(dispatchConfig({}), null);
  assert.equal(dispatchConfig({ ORBIS_RESEARCH_GITHUB_TOKEN: 't', ORBIS_RESEARCH_GITHUB_REPO: 'not a repo' }), null);
  assert.deepEqual(dispatchConfig({ ORBIS_RESEARCH_GITHUB_TOKEN: ' t ', ORBIS_RESEARCH_GITHUB_REPO: 'me/orbis-research-worker' }), {
    token: 't', repo: 'me/orbis-research-worker', workflow: 'research-desk.yml', ref: 'main',
  });
});

test('a dispatch is one workflow_dispatch on the private repo with the run ids', async () => {
  const { calls, fetchImpl } = fakeFetch([204]);
  assert.deepEqual(await dispatchRuns({ mode: 'run', runIds: ['a', 'b'] }, { config: CONFIG, fetch: fetchImpl }), { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.github.com/repos/owner/orbis-research-worker/actions/workflows/research-desk.yml/dispatches');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer github_pat_test');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { ref: 'main', inputs: { mode: 'run', run_ids: 'a,b', user_id: '' } });
});

test('a server error or a dropped connection is tried once more; a refusal is not', async () => {
  const flaky = fakeFetch([502, 204]);
  assert.deepEqual(await dispatchRuns({ mode: 'run', runIds: ['a'] }, { config: CONFIG, fetch: flaky.fetchImpl }), { ok: true });
  assert.equal(flaky.calls.length, 2);
  const down = fakeFetch(['throw', 'throw']);
  assert.deepEqual(await dispatchRuns({ mode: 'run', runIds: ['a'] }, { config: CONFIG, fetch: down.fetchImpl }), { ok: false, reason: 'unreachable' });
  const refused = fakeFetch([401]);
  assert.deepEqual(await dispatchRuns({ mode: 'run', runIds: ['a'] }, { config: CONFIG, fetch: refused.fetchImpl }), { ok: false, reason: 'rejected' });
  assert.equal(refused.calls.length, 1);
  assert.deepEqual(await dispatchRuns({ mode: 'run', runIds: ['a'] }, { config: null, fetch: refused.fetchImpl }), { ok: false, reason: 'not_configured' });
});

test('queueing inserts the run, dispatches it and marks it dispatched', async () => {
  const { db, rows, dispatched } = fakeDb();
  const { fetchImpl, calls } = fakeFetch([204]);
  const result = await queueRuns({ db, dispatch: (input) => dispatchRuns(input, { config: CONFIG, fetch: fetchImpl }), configured: true }, { ...base, targets: [target] });
  assert.deepEqual(result, { ok: true, runIds: ['run-1'], skipped: [] });
  assert.equal(rows[0].ticker, 'RELIANCE.NS');
  assert.equal(rows[0].status, 'queued');
  // India's date: 04:00 UTC is 09:30 IST on the same day.
  assert.equal(rows[0].trade_date, '2026-10-27');
  assert.equal((rows[0].config as { analysts: string[] }).analysts.includes('social'), false);
  assert.deepEqual(dispatched, ['run-1']);
  assert.equal(calls.length, 1);
});

test('a refused dispatch leaves the run failed with a reason, never queued forever', async () => {
  const { db, failed } = fakeDb();
  const { fetchImpl } = fakeFetch([404]);
  const result = await queueRuns({ db, dispatch: (input) => dispatchRuns(input, { config: CONFIG, fetch: fetchImpl }), configured: true }, { ...base, targets: [target] });
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.message, /couldn’t be started/);
  assert.deepEqual(failed.map((entry) => entry.id), ['run-1']);
});

test('nothing is inserted when the worker is not set up, the desk is off, or the month is used up', async () => {
  const dispatch = async () => ({ ok: true as const });
  const unset = fakeDb();
  assert.equal((await queueRuns({ db: unset.db, dispatch, configured: false }, { ...base, targets: [target] })).ok, false);
  assert.equal(unset.rows.length, 0);
  const off = fakeDb();
  assert.equal((await queueRuns({ db: off.db, dispatch, configured: true }, { ...base, settings: { ...DEFAULT_RESEARCH_SETTINGS, enabled: false }, targets: [target] })).ok, false);
  assert.equal(off.rows.length, 0);
  const capped = fakeDb({ monthCount: 40 });
  const refused = await queueRuns({ db: capped.db, dispatch, configured: true }, { ...base, targets: [target] });
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.message, /40 runs/);
  assert.equal(capped.rows.length, 0);
});

test('a ticker already being analysed is not queued twice', async () => {
  const dispatch = async () => ({ ok: true as const });
  const busy = fakeDb({ active: ['RELIANCE.NS'] });
  const one = await queueRuns({ db: busy.db, dispatch, configured: true }, { ...base, targets: [target] });
  assert.equal(one.ok, false);
  assert.match(one.ok ? '' : one.message, /already being analysed/);
  // In a batch (the weekly run) the busy one is skipped and the rest go ahead, within the cap.
  const batch = fakeDb({ active: ['RELIANCE.NS'], monthCount: 38 });
  const more = ['TCS.NS', 'INFY.NS', 'HDFCBANK.NS'].map((ticker) => ({ ok: true as const, ticker, exchange: 'NSE' as const, symbol: ticker.slice(0, -3) }));
  const result = await queueRuns({ db: batch.db, dispatch, configured: true }, { ...base, source: 'weekly', targets: [target, ...more] });
  assert.deepEqual(result, { ok: true, runIds: ['run-1', 'run-2'], skipped: ['RELIANCE.NS', 'HDFCBANK.NS'] });
});

test('only a queued or running run can be cancelled', async () => {
  const live = fakeDb({ status: 'running' });
  assert.equal((await cancelRun({ db: live.db }, { userId: 'u', runId: 'r' })).ok, true);
  const done = fakeDb({ status: 'done' });
  assert.equal((await cancelRun({ db: done.db }, { userId: 'u', runId: 'r' })).ok, false);
});

test('the month starts on the 1st in India', () => {
  // 31 Oct 20:00 UTC is already 1 Nov in India.
  assert.equal(istMonthStart(new Date('2026-10-31T20:00:00Z')), '2026-10-31T18:30:00.000Z');
  assert.equal(istMonthStart(new Date('2026-10-27T04:00:00Z')), '2026-09-30T18:30:00.000Z');
});

const brokers: BrokerPortfolio[] = [
  {
    broker: 'zerodha', state: 'ok', livePrices: true, fetchedAt: null, connection: null,
    holdings: [
      { symbol: 'RELIANCE', isin: 'INE002A01018', quantity: 10, averagePrice: 2500, lastPrice: 2900, dayChangePercent: null, priceSource: null, priceAsOf: null, priceStale: false },
      { symbol: 'SBIN-BE', isin: 'INE062A01020', quantity: 5, averagePrice: 600, lastPrice: 800, dayChangePercent: null, priceSource: null, priceAsOf: null, priceStale: false },
    ],
  },
  {
    broker: 'groww', state: 'ok', livePrices: true, fetchedAt: null, connection: null,
    holdings: [
      { symbol: 'RELIANCE', isin: 'INE002A01018', quantity: 10, averagePrice: 2700, lastPrice: 2900, dayChangePercent: null, priceSource: null, priceAsOf: null, priceStale: false },
      { symbol: 'Axis Bluechip Fund Direct Growth', isin: 'INF846K01DP8', quantity: 100, averagePrice: 50, lastPrice: 60, dayChangePercent: null, priceSource: null, priceAsOf: null, priceStale: false },
    ],
  },
  { broker: 'zerodha', state: 'error', livePrices: false, fetchedAt: null, connection: null, holdings: [] },
];

test('holdings for the desk: biggest first, funds kept and labelled', () => {
  const holdings = deskHoldings(brokers);
  assert.deepEqual(holdings.map((holding) => holding.symbol), ['RELIANCE', 'RELIANCE', 'Axis Bluechip Fund Direct Growth', 'SBIN-BE']);
  assert.equal(holdings[2].target.ok, false);
  assert.equal(holdings[3].target.ok && holdings[3].target.ticker, 'SBIN.NS');
});

test('the portfolio context merges the same ticker across brokers and carries no fund', () => {
  const context = portfolioContextFor(deskHoldings(brokers));
  assert.equal(context.currency, 'INR');
  assert.equal(context.cash, null);
  const reliance = context.positions.find((position) => position.ticker === 'RELIANCE.NS');
  assert.deepEqual(reliance, { ticker: 'RELIANCE.NS', quantity: 20, average_price: 2600 });
  assert.equal(context.positions.length, 2);
});
