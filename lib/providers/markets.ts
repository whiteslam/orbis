import 'server-only';

import { consumeProviderCall, isFresh, readCache, recordProviderStatus, writeCache } from '@/lib/providers/cache';
import { ProviderError, providerFetch, providerJson, type ProviderId } from '@/lib/providers/core';

export type Price = { price: number; changePercent: number | null; asOf: string; source: ProviderId; stale: boolean };

type CachedPrice = { price: number; changePercent: number | null; asOf: string } | null;

const ALPHA_VANTAGE_DAILY_LIMIT = 20; // Free tier allows 25; keep headroom.
const ALPHA_VANTAGE_MAX_FRESH_PER_LOAD = 5;
const MISS_TTL = 24 * 60 * 60;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function indianMarketOpen(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  return !['Sat', 'Sun'].includes(get('weekday')) && minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30;
}

function toPrice(value: CachedPrice, source: ProviderId, stale: boolean): Price | null {
  return value ? { ...value, source, stale } : null;
}

const quoteKey = (symbol: string) => `quote:alpha_vantage:${symbol}`;

type CacheRows = Awaited<ReturnType<typeof readCache>>;

/** A cached quote kept past its freshness, for when a fresh one cannot be had. */
function staleQuote(rows: CacheRows, symbol: string) {
  const row = rows.get(quoteKey(symbol));
  return row ? toPrice(row.response as CachedPrice, 'alpha_vantage', true) : null;
}

const asProviderError = (error: unknown) => (error instanceof ProviderError ? error : new ProviderError('alpha_vantage', 'unavailable'));

/** One GLOBAL_QUOTE call: the quote, or null for a symbol Alpha Vantage does not price. Throws when it refuses. */
async function fetchQuote(symbol: string, apiKey: string): Promise<CachedPrice> {
  const body = await providerJson<Record<string, unknown>>('alpha_vantage', `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`);
  if (typeof body.Information === 'string' || typeof body.Note === 'string') throw new ProviderError('alpha_vantage', 'rate_limited');
  if (typeof body['Error Message'] === 'string') throw new ProviderError('alpha_vantage', 'invalid_request');
  const quote = body['Global Quote'] as Record<string, string> | undefined;
  const price = Number(quote?.['05. price']);
  if (!quote || !Number.isFinite(price) || price <= 0) return null;
  return { price, changePercent: Number.parseFloat(quote['10. change percent'] ?? '') || null, asOf: quote['07. latest trading day'] ?? new Date().toISOString().slice(0, 10) };
}

/**
 * Fetches the symbols the cache could not answer, within the daily quota and at
 * one call a second. Once one call fails, the rest fall back to their stale rows.
 * Returns the failure that stopped it, if any.
 */
async function fetchQuotes(toFetch: string[], rows: CacheRows, apiKey: string | undefined, result: Map<string, Price | null>) {
  let failure: ProviderError | null = apiKey ? null : new ProviderError('alpha_vantage', 'not_configured');
  const ttl = indianMarketOpen() ? 60 * 60 : 12 * 60 * 60;

  for (const [index, symbol] of toFetch.entries()) {
    if (failure || index >= ALPHA_VANTAGE_MAX_FRESH_PER_LOAD) {
      result.set(symbol, staleQuote(rows, symbol));
      continue;
    }
    if (!(await consumeProviderCall('alpha_vantage', ALPHA_VANTAGE_DAILY_LIMIT))) { // NOSONAR: the daily quota is counted one call at a time
      failure = new ProviderError('alpha_vantage', 'rate_limited');
      result.set(symbol, staleQuote(rows, symbol));
      continue;
    }
    if (index > 0) await wait(1_100); // NOSONAR: free tier allows one request per second
    try {
      const value = await fetchQuote(symbol, apiKey!); // NOSONAR: rate-limited API, one call a second
      await writeCache('alpha_vantage', [{ key: quoteKey(symbol), response: value, ttlSeconds: value ? ttl : MISS_TTL }]); // NOSONAR: written before the next call, which may fail and stop the loop
      result.set(symbol, toPrice(value, 'alpha_vantage', false));
    } catch (error) {
      failure = asProviderError(error);
      result.set(symbol, staleQuote(rows, symbol));
    }
  }
  return failure;
}

// Stock quotes from Alpha Vantage, e.g. "SALASAR.BSE". Unsupported symbols are
// remembered for a day so they don't use up the small free quota.
export async function getStockQuotes(symbols: string[]): Promise<Map<string, Price | null>> {
  const result = new Map<string, Price | null>();
  const unique = Array.from(new Set(symbols.map((symbol) => symbol.toUpperCase()))).slice(0, 50);
  if (!unique.length) return result;

  const rows = await readCache(unique.map(quoteKey));
  const toFetch: string[] = [];
  for (const symbol of unique) {
    const row = rows.get(quoteKey(symbol));
    if (row && isFresh(row)) result.set(symbol, toPrice(row.response as CachedPrice, 'alpha_vantage', false));
    else toFetch.push(symbol);
  }

  const apiKey = process.env.ALPHA_VANTAGE_API_KEY?.trim();
  const failure = await fetchQuotes(toFetch, rows, apiKey, result);

  if (toFetch.length && apiKey) await recordProviderStatus('alpha_vantage', failure ? failure.kind : 'success');
  return result;
}

/** AMFI's date, as YYYY-MM-DD when it parses, else as written. */
function navAsOf(cell: string) {
  const asOf = new Date(`${cell} UTC`);
  return Number.isNaN(asOf.getTime()) ? cell : asOf.toISOString().slice(0, 10);
}

/** The NAVs in AMFI's NAVAll.txt for the ISINs wanted, matched on either ISIN column. */
function parseNavs(text: string, wanted: Set<string>) {
  const found = new Map<string, CachedPrice>();
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(';');
    if (cells.length < 8) continue;
    const nav = Number(cells[6]);
    if (!Number.isFinite(nav) || nav <= 0) continue;
    for (const isin of [cells[1], cells[2]]) {
      if (wanted.has(isin)) found.set(isin, { price: nav, changePercent: null, asOf: navAsOf(cells[7]) });
    }
  }
  return found;
}

// Latest NAV for Indian mutual funds and ETFs by ISIN, from AMFI's free daily file.
export async function getFundNavs(isins: string[]): Promise<Map<string, Price | null>> {
  const result = new Map<string, Price | null>();
  const unique = Array.from(new Set(isins.map((isin) => isin.toUpperCase()).filter((isin) => /^IN[A-Z0-9]{10}$/.test(isin)))).slice(0, 200);
  if (!unique.length) return result;

  const keyOf = (isin: string) => `nav:amfi:${isin}`;
  const rows = await readCache(unique.map(keyOf));
  const missing = unique.filter((isin) => {
    const row = rows.get(keyOf(isin));
    if (row && isFresh(row)) {
      result.set(isin, toPrice(row.response as CachedPrice, 'amfi', false));
      return false;
    }
    return true;
  });
  if (!missing.length) return result;

  try {
    const text = await providerFetch('amfi', 'https://portal.amfiindia.com/spages/NAVAll.txt', { timeoutMs: 20_000 });
    const found = parseNavs(text, new Set(missing));
    await writeCache('amfi', missing.map((isin) => ({ key: keyOf(isin), response: found.get(isin) ?? null, ttlSeconds: found.has(isin) ? 6 * 60 * 60 : MISS_TTL })));
    await recordProviderStatus('amfi', 'success');
    for (const isin of missing) result.set(isin, toPrice(found.get(isin) ?? null, 'amfi', false));
  } catch (error) {
    await recordProviderStatus('amfi', error instanceof ProviderError ? error.kind : 'unavailable');
    for (const isin of missing) {
      const row = rows.get(keyOf(isin));
      result.set(isin, row ? toPrice(row.response as CachedPrice, 'amfi', true) : null);
    }
  }
  return result;
}
