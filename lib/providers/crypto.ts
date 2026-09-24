import 'server-only';

import { consumeProviderCall, isFresh, readCache, recordProviderStatus, writeCache } from '@/lib/providers/cache';
import { ProviderError, providerJson } from '@/lib/providers/core';
import type { Price } from '@/lib/providers/markets';

const DAILY_LIMIT = 300; // Demo plan: 10k calls/month.

// INR prices for CoinGecko coin ids such as "bitcoin" or "ethereum".
export async function getCryptoPrices(ids: string[]): Promise<Map<string, Price | null>> {
  const result = new Map<string, Price | null>();
  const unique = Array.from(new Set(ids.map((id) => id.toLowerCase()).filter((id) => /^[a-z0-9-]{1,60}$/.test(id)))).slice(0, 50);
  if (!unique.length) return result;

  const keyOf = (id: string) => `crypto:coingecko:${id}`;
  const rows = await readCache(unique.map(keyOf));
  const missing = unique.filter((id) => {
    const row = rows.get(keyOf(id));
    if (row && isFresh(row)) {
      const value = row.response as Omit<Price, 'source' | 'stale'> | null;
      result.set(id, value ? { ...value, source: 'coingecko', stale: false } : null);
      return false;
    }
    return true;
  });
  if (!missing.length) return result;

  const staleFallback = () => {
    for (const id of missing) {
      const value = rows.get(keyOf(id))?.response as Omit<Price, 'source' | 'stale'> | null | undefined;
      result.set(id, value ? { ...value, source: 'coingecko', stale: true } : null);
    }
  };

  const apiKey = process.env.COINGECKO_API_KEY?.trim();
  if (!apiKey) {
    staleFallback();
    return result;
  }
  if (!(await consumeProviderCall('coingecko', DAILY_LIMIT))) {
    await recordProviderStatus('coingecko', 'rate_limited');
    staleFallback();
    return result;
  }

  try {
    const body = await providerJson<Record<string, { inr?: number; inr_24h_change?: number; last_updated_at?: number }>>(
      'coingecko',
      `https://api.coingecko.com/api/v3/simple/price?ids=${missing.join(',')}&vs_currencies=inr&include_24hr_change=true&include_last_updated_at=true`,
      { headers: { accept: 'application/json', 'x-cg-demo-api-key': apiKey } },
    );
    const entries = missing.map((id) => {
      const coin = body[id];
      const value = coin && typeof coin.inr === 'number' && coin.inr > 0
        ? { price: coin.inr, changePercent: typeof coin.inr_24h_change === 'number' ? coin.inr_24h_change : null, asOf: new Date((coin.last_updated_at ?? Date.now() / 1000) * 1000).toISOString() }
        : null;
      result.set(id, value ? { ...value, source: 'coingecko', stale: false } : null);
      return { key: keyOf(id), response: value, ttlSeconds: value ? 5 * 60 : 24 * 60 * 60 };
    });
    await Promise.all([writeCache('coingecko', entries), recordProviderStatus('coingecko', 'success')]);
  } catch (error) {
    await recordProviderStatus('coingecko', error instanceof ProviderError ? error.kind : 'unavailable');
    staleFallback();
  }
  return result;
}
