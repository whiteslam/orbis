import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { isResearchTicker, parseTypedTicker, researchTarget } from './tickers';
import { researchDeskAllowed } from './access';

const stock = (symbol: string, isin: string | null = 'INE002A01018') => researchTarget({ symbol, isin, assetClass: 'Stocks' });

test('broker symbols map to Yahoo tickers on NSE', () => {
  assert.deepEqual(stock('RELIANCE'), { ok: true, ticker: 'RELIANCE.NS', exchange: 'NSE', symbol: 'RELIANCE' });
  // Zerodha's series suffix is not part of the Yahoo ticker.
  assert.deepEqual(stock('SBIN-BE'), { ok: true, ticker: 'SBIN.NS', exchange: 'NSE', symbol: 'SBIN-BE' });
  // A hyphen or an ampersand that is part of the name stays.
  assert.equal((stock('BAJAJ-AUTO') as { ticker: string }).ticker, 'BAJAJ-AUTO.NS');
  assert.equal((stock('M&M') as { ticker: string }).ticker, 'M&M.NS');
  assert.equal((stock(' infy ') as { ticker: string }).ticker, 'INFY.NS');
});

test('a BSE scrip code maps to .BO', () => {
  assert.deepEqual(stock('500325'), { ok: true, ticker: '500325.BO', exchange: 'BSE', symbol: '500325' });
});

test('ETFs are supported; mutual funds are labelled, not analysed', () => {
  assert.equal(researchTarget({ symbol: 'GOLDBEES', isin: 'INF204KB17I5', assetClass: 'Gold & silver' }).ok, true);
  assert.equal(researchTarget({ symbol: 'NIFTYBEES', isin: 'INF204KB14I2', assetClass: 'ETFs' }).ok, true);
  assert.deepEqual(researchTarget({ symbol: 'Parag Parikh Flexi Cap Fund Direct Growth', isin: 'INF879O01027', assetClass: 'ETFs' }), { ok: false, reason: 'fund' });
  assert.deepEqual(researchTarget({ symbol: 'HDFCMIDCAP', isin: null, assetClass: 'Mutual funds' }), { ok: false, reason: 'fund' });
});

test('anything that is not a listed symbol is refused', () => {
  for (const junk of ['../etc', 'a b', 'X'.repeat(30), '', 'AAPL.O', 'RELIANCE.NSE']) {
    assert.deepEqual(stock(junk), { ok: false, reason: 'unsupported' }, junk);
  }
});

test('a typed ticker accepts the usual spellings', () => {
  assert.equal((parseTypedTicker('reliance') as { ticker: string }).ticker, 'RELIANCE.NS');
  assert.equal((parseTypedTicker('RELIANCE.NS') as { ticker: string }).ticker, 'RELIANCE.NS');
  assert.equal((parseTypedTicker('tcs.bo') as { ticker: string }).ticker, 'TCS.BO');
  assert.deepEqual(parseTypedTicker('NSE:INFY'), { ok: true, ticker: 'INFY.NS', exchange: 'NSE', symbol: 'INFY' });
  assert.deepEqual(parseTypedTicker('BSE: 500325'), { ok: true, ticker: '500325.BO', exchange: 'BSE', symbol: '500325' });
  assert.equal(parseTypedTicker('NASDAQ:AAPL').ok, false);
  assert.equal(parseTypedTicker('drop table').ok, false);
});

test('only Indian Yahoo tickers pass the final check', () => {
  assert.equal(isResearchTicker('RELIANCE.NS'), true);
  assert.equal(isResearchTicker('500325.BO'), true);
  assert.equal(isResearchTicker('AAPL'), false);
  assert.equal(isResearchTicker('reliance.ns'), false);
});

const saved = process.env.ORBIS_RESEARCH_DESK_EMAILS;
afterEach(() => {
  if (saved === undefined) delete process.env.ORBIS_RESEARCH_DESK_EMAILS;
  else process.env.ORBIS_RESEARCH_DESK_EMAILS = saved;
});

test('the desk is shut to everyone until an address is listed', () => {
  delete process.env.ORBIS_RESEARCH_DESK_EMAILS;
  assert.equal(researchDeskAllowed('owner@example.com'), false);
  process.env.ORBIS_RESEARCH_DESK_EMAILS = '  ';
  assert.equal(researchDeskAllowed('owner@example.com'), false);
});

test('only listed addresses get the desk, whatever their case', () => {
  process.env.ORBIS_RESEARCH_DESK_EMAILS = 'Owner@Example.com, other@example.com';
  assert.equal(researchDeskAllowed('owner@example.com'), true);
  assert.equal(researchDeskAllowed(' OWNER@example.com '), true);
  assert.equal(researchDeskAllowed('stranger@example.com'), false);
  assert.equal(researchDeskAllowed(null), false);
  assert.equal(researchDeskAllowed(''), false);
});

test('the desk only shows when the worker is set up as well', async () => {
  const { researchDeskAvailable } = await import('./access');
  process.env.ORBIS_RESEARCH_DESK_EMAILS = 'owner@example.com';
  assert.equal(researchDeskAvailable('owner@example.com', true), true);
  assert.equal(researchDeskAvailable('owner@example.com', false), false);
  assert.equal(researchDeskAvailable('stranger@example.com', true), false);
});
