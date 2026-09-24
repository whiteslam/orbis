import 'server-only';

import { createHash } from 'node:crypto';
import type { GrowwHolding, GrowwPortfolio } from '@/lib/invest/types';
import { getFundNavs, getStockQuotes } from '@/lib/providers/markets';

// Read-only Groww Trade API client: access token, holdings, and (when the plan
// allows it) last traded prices. Never add order endpoints here.
const BASE_URL = 'https://api.groww.in/v1';
const TOKEN_TTL_MS = 30 * 60 * 1000;
const LTP_BATCH_SIZE = 50;

export type GrowwCredentials = { apiKey: string; apiSecret: string };

// Access tokens per API key, so several connected users never share one.
const tokenCache = new Map<string, { value: string; expiresAt: number }>();
const tokenCacheKey = (credentials: GrowwCredentials) => createHash('sha256').update(credentials.apiKey).digest('hex');
// Groww answers 403 when the API plan has no live data; don't ask every load.
let livePricesBlockedUntil = 0;

export class GrowwError extends Error {}

export class GrowwAuthError extends GrowwError {}

// Server-wide fallback credentials from the environment (single-owner setups).
export function envGrowwCredentials(): GrowwCredentials | null {
  const apiKey = process.env.GROWW_API_KEY?.trim();
  const apiSecret = process.env.GROWW_API_SECRET?.trim();
  return apiKey && apiSecret ? { apiKey, apiSecret } : null;
}

export function growwConfigured() {
  return Boolean(process.env.GROWW_API_KEY?.trim() && process.env.GROWW_API_SECRET?.trim());
}

export function growwOwnerEmail() {
  return process.env.GROWW_OWNER_EMAIL?.trim().toLowerCase() || null;
}

export async function getAccessToken(credentials: GrowwCredentials) {
  const cacheKey = tokenCacheKey(credentials);
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const { apiKey, apiSecret: secret } = credentials;

  const timestamp = String(Math.floor(Date.now() / 1000));
  const checksum = createHash('sha256').update(secret + timestamp).digest('hex');
  const response = await fetch(`${BASE_URL}/token/api/access`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ key_type: 'approval', checksum, timestamp }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null) as { token?: unknown } | null;
  if (!response.ok || typeof body?.token !== 'string') {
    const ErrorType = response.status === 400 || response.status === 401 || response.status === 403 ? GrowwAuthError : GrowwError;
    throw new ErrorType(response.status === 400 || response.status === 401 || response.status === 403
      ? 'Groww did not approve the API key. Approve today’s access on the Groww Cloud API keys page, or regenerate the key and secret.'
      : 'Groww could not issue an access token. Try again shortly.');
  }
  tokenCache.set(cacheKey, { value: body.token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return body.token;
}

async function growwGet(path: string, token: string, cacheKey?: string) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'x-api-version': '1.0' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401 && cacheKey) tokenCache.delete(cacheKey);
  const body = await response.json().catch(() => null) as { status?: string; payload?: unknown } | null;
  return { ok: response.ok && body?.status === 'SUCCESS', status: response.status, payload: body?.payload };
}

async function loadPrices(symbols: string[], token: string) {
  if (livePricesBlockedUntil > Date.now()) return null;
  const prices = new Map<string, number>();
  for (let index = 0; index < symbols.length; index += LTP_BATCH_SIZE) {
    const batch = symbols.slice(index, index + LTP_BATCH_SIZE).map((symbol) => `NSE_${symbol}`);
    const result = await growwGet(`/live-data/ltp?segment=CASH&exchange_symbols=${encodeURIComponent(batch.join(','))}`, token);
    // Live data needs a Groww plan that includes it; holdings still work without it.
    if (result.status === 403) livePricesBlockedUntil = Date.now() + 6 * 60 * 60 * 1000;
    if (!result.ok || !result.payload || typeof result.payload !== 'object') return null;
    for (const [key, value] of Object.entries(result.payload as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) prices.set(key.replace(/^NSE_/, ''), value);
    }
  }
  return prices;
}

export async function fetchGrowwPortfolio(credentials: GrowwCredentials): Promise<Pick<GrowwPortfolio, 'livePrices' | 'fetchedAt' | 'holdings'>> {
  const token = await getAccessToken(credentials);
  const holdingsResult = await growwGet('/holdings/user', token, tokenCacheKey(credentials));
  if (holdingsResult.status === 401 || holdingsResult.status === 403) throw new GrowwAuthError('Groww rejected this connection. Approve today’s access on the Groww API keys page, or reconnect with a new key.');
  if (!holdingsResult.ok) throw new GrowwError('Groww holdings could not be loaded. Try again shortly.');

  const rawHoldings = (holdingsResult.payload as { holdings?: unknown })?.holdings;
  const holdings = (Array.isArray(rawHoldings) ? rawHoldings : []).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const { trading_symbol: symbol, isin, quantity, average_price: averagePrice } = item as Record<string, unknown>;
    if (typeof symbol !== 'string' || typeof quantity !== 'number' || typeof averagePrice !== 'number' || quantity <= 0) return [];
    return [{ symbol: symbol.slice(0, 40), isin: typeof isin === 'string' ? isin.slice(0, 20) : null, quantity, averagePrice }];
  });

  const growwPrices = holdings.length ? await loadPrices(holdings.map((holding) => holding.symbol), token) : null;
  const priced: GrowwHolding[] = holdings.map((holding) => {
    const lastPrice = growwPrices?.get(holding.symbol) ?? null;
    return { ...holding, lastPrice, priceSource: lastPrice === null ? null : 'groww', priceAsOf: lastPrice === null ? null : new Date().toISOString(), priceStale: false };
  });

  // Fallbacks when Groww has no live price: AMFI NAV for fund/ETF units (ISIN INF…),
  // Alpha Vantage BSE quotes for company shares.
  const unpriced = priced.filter((holding) => holding.lastPrice === null);
  if (unpriced.length) {
    const funds = unpriced.filter((holding) => holding.isin?.startsWith('INF'));
    const stocks = unpriced.filter((holding) => !holding.isin?.startsWith('INF'));
    const [navs, quotes] = await Promise.all([
      getFundNavs(funds.map((holding) => holding.isin!)),
      getStockQuotes(stocks.map((holding) => `${holding.symbol}.BSE`)),
    ]);
    for (const holding of unpriced) {
      const price = holding.isin?.startsWith('INF') ? navs.get(holding.isin.toUpperCase()) : quotes.get(`${holding.symbol}.BSE`.toUpperCase());
      if (!price) continue;
      holding.lastPrice = price.price;
      holding.priceSource = price.source === 'amfi' ? 'amfi' : 'alpha_vantage';
      holding.priceAsOf = price.asOf;
      holding.priceStale = price.stale;
    }
  }

  return {
    livePrices: priced.length > 0 && priced.every((holding) => holding.lastPrice !== null),
    fetchedAt: new Date().toISOString(),
    holdings: priced,
  };
}
