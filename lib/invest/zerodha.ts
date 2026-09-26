import 'server-only';

import { createHash } from 'node:crypto';
import type { BrokerHolding, BrokerPortfolio } from '@/lib/invest/types';

/**
 * Read-only Zerodha Kite Connect client. Never add order endpoints here.
 *
 * Kite's session model is unlike Groww's and shapes everything around it. A key
 * and secret cannot fetch holdings on their own: you send the user to Zerodha,
 * they log in, Zerodha redirects back with a request_token, and that is
 * exchanged for an access_token which expires the following morning. There is
 * no refresh token and no way to renew it server-side, by design. So a Zerodha
 * connection is reconnected daily, and the app has to say so rather than quietly
 * showing yesterday's numbers.
 */
const BASE_URL = 'https://api.kite.trade';
const LOGIN_URL = 'https://kite.zerodha.com/connect/login';

export class ZerodhaError extends Error {}
/** The access token has expired or was revoked: the user must log in again. */
export class ZerodhaAuthError extends ZerodhaError {}

export type ZerodhaCredentials = { apiKey: string; apiSecret: string };

export function envZerodhaCredentials(): ZerodhaCredentials | null {
  const apiKey = process.env.ZERODHA_API_KEY?.trim();
  const apiSecret = process.env.ZERODHA_API_SECRET?.trim();
  return apiKey && apiSecret ? { apiKey, apiSecret } : null;
}

/** Where the user is sent to authorise Orbis. Kite appends the request_token to the app's redirect URL. */
export function zerodhaLoginUrl(apiKey: string) {
  return `${LOGIN_URL}?v=3&api_key=${encodeURIComponent(apiKey)}`;
}

/**
 * Kite tokens die at the start of the next trading day rather than after a
 * fixed span, so expiry is the next 06:00 IST. Treating it as "valid for N
 * hours" would keep a dead token past the cutover.
 */
export function accessTokenExpiry(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  const next = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 0, 30, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

type KiteResponse<T> = { status?: string; data?: T; message?: string; error_type?: string };

async function kite<T>(path: string, init: RequestInit & { apiKey: string; accessToken?: string }): Promise<T> {
  const { apiKey, accessToken, ...request } = init;
  const response = await fetch(`${BASE_URL}${path}`, {
    ...request,
    headers: {
      'X-Kite-Version': '3',
      ...(accessToken ? { authorization: `token ${apiKey}:${accessToken}` } : {}),
      ...(request.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });

  const body = await response.json().catch(() => null) as KiteResponse<T> | null;
  if (!response.ok || body?.status === 'error') {
    const message = body?.message ?? 'Zerodha could not be reached. Try again shortly.';
    if (response.status === 403 || body?.error_type === 'TokenException') throw new ZerodhaAuthError(message);
    throw new ZerodhaError(message);
  }
  if (!body?.data) throw new ZerodhaError('Zerodha returned an unexpected response.');
  return body.data;
}

export type ZerodhaSession = { accessToken: string; kiteUserId: string; expiresAt: Date };

/** Trades the one-time request_token for a session. The checksum is Kite's proof the caller holds the secret. */
export async function exchangeRequestToken(credentials: ZerodhaCredentials, requestToken: string): Promise<ZerodhaSession> {
  const checksum = createHash('sha256').update(`${credentials.apiKey}${requestToken}${credentials.apiSecret}`).digest('hex');
  const data = await kite<{ access_token?: string; user_id?: string }>('/session/token', {
    method: 'POST',
    apiKey: credentials.apiKey,
    body: new URLSearchParams({ api_key: credentials.apiKey, request_token: requestToken, checksum }).toString(),
  });
  if (!data.access_token) throw new ZerodhaAuthError('Zerodha did not return a session. Try connecting again.');
  return { accessToken: data.access_token, kiteUserId: data.user_id ?? '', expiresAt: accessTokenExpiry() };
}

type KiteHolding = {
  tradingsymbol?: unknown; isin?: unknown; quantity?: unknown; t1_quantity?: unknown;
  average_price?: unknown; last_price?: unknown; day_change_percentage?: unknown;
};

/**
 * Holdings, already priced.
 *
 * Kite returns last_price and day_change_percentage with the holding itself, so
 * unlike Groww there is no second call to a market data provider and today's
 * move is known for every position rather than inferred.
 */
export async function fetchZerodhaPortfolio(credentials: ZerodhaCredentials, accessToken: string): Promise<Pick<BrokerPortfolio, 'livePrices' | 'fetchedAt' | 'holdings'>> {
  const data = await kite<KiteHolding[]>('/portfolio/holdings', { apiKey: credentials.apiKey, accessToken });
  const now = new Date().toISOString();

  const holdings: BrokerHolding[] = (Array.isArray(data) ? data : []).flatMap((item) => {
    const symbol = typeof item.tradingsymbol === 'string' ? item.tradingsymbol : null;
    const average = typeof item.average_price === 'number' ? item.average_price : null;
    // T1 holdings are bought but not yet settled; they are still owned, so they count.
    const quantity = (typeof item.quantity === 'number' ? item.quantity : 0) + (typeof item.t1_quantity === 'number' ? item.t1_quantity : 0);
    if (!symbol || average === null || quantity <= 0) return [];
    const lastPrice = typeof item.last_price === 'number' && item.last_price > 0 ? item.last_price : null;
    return [{
      symbol: symbol.slice(0, 40),
      isin: typeof item.isin === 'string' ? item.isin.slice(0, 20) : null,
      quantity,
      averagePrice: average,
      lastPrice,
      dayChangePercent: typeof item.day_change_percentage === 'number' ? item.day_change_percentage : null,
      priceSource: lastPrice === null ? null : 'zerodha',
      priceAsOf: lastPrice === null ? null : now,
      priceStale: false,
    }];
  });

  return {
    livePrices: holdings.length > 0 && holdings.every((holding) => holding.lastPrice !== null),
    fetchedAt: now,
    holdings,
  };
}
