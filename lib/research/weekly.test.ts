import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mondayOf, weekBefore, weeklyHeadsup, weeklyPicks } from './weekly';
import type { DeskHolding } from './context';
import { researchTarget } from './tickers';
import { RESEARCH_DISCLAIMER, type ResearchRun } from './types';
import type { AssetClass } from '@/lib/invest/analysis';

function holding(symbol: string, value: number, assetClass: AssetClass = 'Stocks', isin: string | null = null, broker: 'zerodha' | 'groww' = 'zerodha'): DeskHolding {
  return {
    key: `${broker}:${isin ?? symbol}`,
    symbol,
    broker,
    assetClass,
    value,
    quantity: 1,
    averagePrice: value,
    target: researchTarget({ symbol, isin, assetClass }),
  };
}

test('weeklyPicks takes the largest supported stocks and ETFs, top n', () => {
  const picks = weeklyPicks([
    holding('INFY', 50_000),
    holding('RELIANCE', 90_000),
    holding('NIFTYBEES', 70_000, 'ETFs'),
    holding('TCS', 10_000),
  ], 3);
  assert.deepEqual(picks.map((pick) => pick.ticker), ['RELIANCE.NS', 'NIFTYBEES.NS', 'INFY.NS']);
  assert.ok(picks.every((pick) => pick.ok));
});

test('weeklyPicks leaves out funds, unsupported symbols and gold or silver', () => {
  const picks = weeklyPicks([
    holding('Parag Parikh Flexi Cap', 500_000, 'Mutual funds', 'INF879O01027'),
    holding('../x', 400_000),
    holding('GOLDBEES', 300_000, 'Gold & silver'),
    holding('SBIN-BE', 20_000),
  ], 5);
  assert.deepEqual(picks.map((pick) => pick.ticker), ['SBIN.NS']);
});

test('weeklyPicks counts a ticker held on two brokers once, by its combined value', () => {
  const picks = weeklyPicks([
    holding('HDFCBANK', 40_000, 'Stocks', null, 'zerodha'),
    holding('ITC', 60_000),
    holding('HDFCBANK', 30_000, 'Stocks', null, 'groww'),
  ], 2);
  assert.deepEqual(picks.map((pick) => pick.ticker), ['HDFCBANK.NS', 'ITC.NS']);
});

test('weeklyPicks with n of zero or nothing supported picks nothing', () => {
  assert.deepEqual(weeklyPicks([holding('INFY', 1_000)], 0), []);
  assert.deepEqual(weeklyPicks([holding('Some Fund', 1_000, 'Mutual funds')], 5), []);
});

test('mondayOf gives the Monday of an IST date’s week', () => {
  assert.equal(mondayOf('2026-11-02'), '2026-11-02'); // a Monday
  assert.equal(mondayOf('2026-10-31'), '2026-10-26'); // Saturday
  assert.equal(mondayOf('2026-11-01'), '2026-10-26'); // Sunday
  assert.equal(weekBefore('2026-11-02'), '2026-10-26');
});

let next = 0;
function run(patch: Partial<ResearchRun>): ResearchRun {
  next += 1;
  return {
    id: `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`,
    ticker: 'INFY.NS', symbol: 'INFY', exchange: 'NSE', tradeDate: '2026-10-31', source: 'weekly', status: 'done',
    portfolio: null,
    decision: { rating: 'Buy', summary: null, thesis: null, priceTarget: null, horizon: null, entry: null, stop: null, sizing: null, trader: 'Buy' },
    costUsd: null, tokens: null, error: null, dispatchedAt: null, startedAt: null, finishedAt: null, createdAt: '2026-10-31T03:30:00Z',
    ...patch,
  };
}

const decided = (rating: 'Buy' | 'Hold' | 'Sell' | 'REVIEW') => ({ rating, summary: null, thesis: null, priceTarget: null, horizon: null, entry: null, stop: null, sizing: null, trader: null });

test('weeklyHeadsup is null when no weekly run finished that week', () => {
  assert.equal(weeklyHeadsup([], '2026-11-02'), null);
  assert.equal(weeklyHeadsup([
    run({ source: 'manual' }),
    run({ status: 'failed' }),
    run({ status: 'running' }),
    run({ tradeDate: '2026-10-24' }), // the weekend before
    run({ tradeDate: '2026-11-02' }), // this Monday: next week's
  ], '2026-11-02'), null);
});

test('weeklyHeadsup counts the weekend’s calls by rating and opens the desk', () => {
  const headsup = weeklyHeadsup([
    run({ decision: decided('Hold') }),
    run({ decision: decided('Buy') }),
    run({ decision: decided('Hold') }),
    run({ status: 'failed', decision: null }),
    run({ source: 'manual', decision: decided('Sell') }),
  ], '2026-11-02');
  assert.ok(headsup);
  assert.equal(headsup.kind, 'money.research_week');
  assert.equal(headsup.dedupeKey, 'research-week:2026-11-02');
  assert.deepEqual(headsup.action, { type: 'open_research' });
  assert.equal(headsup.urgency, 'normal');
  assert.equal(headsup.title, 'Your weekend research is in');
  assert.equal(headsup.body, `3 calls finished: 1 Buy, 2 Hold. 1 run didn’t finish. ${RESEARCH_DISCLAIMER}`);
  assert.equal(headsup.actionLabel, 'Open the desk');
  // Counts only: no tickers or ratings in what is stored beside it.
  assert.deepEqual(headsup.evidence, { weekOf: '2026-11-02', finished: 3, unfinished: 1 });
  assert.ok(headsup.title.length <= 80 && headsup.body.length <= 300);
});

test('weeklyHeadsup words one call, and a call without a readable rating', () => {
  const one = weeklyHeadsup([run({ decision: decided('Sell') })], '2026-11-02');
  assert.equal(one?.body, `1 call finished: 1 Sell. ${RESEARCH_DISCLAIMER}`);
  const review = weeklyHeadsup([run({ decision: decided('REVIEW') }), run({ decision: null }), run({})], '2026-11-02');
  assert.equal(review?.body, `3 calls finished: 1 Buy, 2 to review. ${RESEARCH_DISCLAIMER}`);
});
