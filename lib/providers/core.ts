import 'server-only';

// Shared plumbing for external data providers. The UI never sees raw provider
// errors: every failure becomes one ProviderError kind with a plain message.

export type ProviderId = 'open_meteo' | 'frankfurter' | 'alpha_vantage' | 'amfi' | 'coingecko';

export type ProviderErrorKind = 'rate_limited' | 'auth' | 'unavailable' | 'invalid_request' | 'timeout' | 'not_configured';

const MESSAGES: Record<ProviderErrorKind, string> = {
  rate_limited: 'is busy right now. Showing the last saved data where possible.',
  auth: 'could not verify the API key. Check it in the server environment.',
  unavailable: 'is temporarily unavailable.',
  invalid_request: 'could not find that item.',
  timeout: 'took too long to respond.',
  not_configured: 'is not set up yet.',
};

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  open_meteo: 'Weather',
  frankfurter: 'Currency rates',
  alpha_vantage: 'Stock prices',
  amfi: 'Fund & ETF prices',
  coingecko: 'Crypto prices',
};

export class ProviderError extends Error {
  constructor(readonly provider: ProviderId, readonly kind: ProviderErrorKind) {
    super(`${PROVIDER_LABEL[provider]} ${MESSAGES[kind]}`);
  }
}

export type Fetched<T> = { data: T; fetchedAt: string; stale: boolean };

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export async function providerFetch(provider: ProviderId, url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 10_000, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(url, { ...rest, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new ProviderError(provider, error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'unavailable');
  }
  if (response.status === 429) throw new ProviderError(provider, 'rate_limited');
  if (response.status === 401 || response.status === 403) throw new ProviderError(provider, 'auth');
  if (response.status === 400 || response.status === 404 || response.status === 422) throw new ProviderError(provider, 'invalid_request');
  if (!response.ok) throw new ProviderError(provider, 'unavailable');

  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new ProviderError(provider, 'unavailable');
  return text;
}

export async function providerJson<T = unknown>(provider: ProviderId, url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const text = await providerFetch(provider, url, init);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError(provider, 'unavailable');
  }
}

export function friendlyProviderMessage(error: unknown, fallback = 'Live data is temporarily unavailable.') {
  return error instanceof ProviderError ? error.message : fallback;
}
