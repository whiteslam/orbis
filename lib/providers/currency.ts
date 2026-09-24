import 'server-only';

import { cached } from '@/lib/providers/cache';
import { ProviderError, providerJson, type Fetched } from '@/lib/providers/core';

// Frankfurter publishes ECB reference rates once per working day.
export const SUPPORTED_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY', 'CHF', 'CNY', 'HKD', 'NZD', 'SEK', 'THB'] as const;

export type Rates = { base: string; date: string; rates: Record<string, number> };

export function isSupportedCurrency(code: string) {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(code);
}

export async function getRates(base: string): Promise<Fetched<Rates>> {
  if (!isSupportedCurrency(base)) throw new ProviderError('frankfurter', 'invalid_request');
  const symbols = SUPPORTED_CURRENCIES.filter((code) => code !== base).join(',');
  return cached('frankfurter', `rates:${base}`, 12 * 60 * 60, async () => {
    const body = await providerJson<{ base?: string; date?: string; rates?: Record<string, number> }>('frankfurter', `https://api.frankfurter.dev/v1/latest?base=${base}&symbols=${symbols}`);
    if (!body.rates || typeof body.date !== 'string') throw new ProviderError('frankfurter', 'unavailable');
    return { base, date: body.date, rates: body.rates };
  });
}

// How many INR one unit of each supported currency is worth.
export async function getRatesToInr(): Promise<Fetched<Record<string, number>>> {
  const result = await getRates('INR');
  const toInr: Record<string, number> = { INR: 1 };
  for (const [code, perInr] of Object.entries(result.data.rates)) {
    if (perInr > 0) toInr[code] = 1 / perInr;
  }
  return { ...result, data: toInr };
}
