import type { MetaPlatform } from '@/lib/meta/types';

const REFRESH_WITHIN_MS = 7 * 86_400_000;
const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' ? value as Record<string, unknown> : null);
const text = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : null);

/** Meta appends "#_" to the code in the redirect; it is not part of the code. */
export function stripCode(code: string) {
  return code.replace(/#_$/, '');
}

/**
 * The short-lived token from the code exchange. Instagram's docs show it both
 * flat and wrapped in `data: [...]`. `user_id` is deliberately never read: it
 * is a JSON number above 2^53, so JSON.parse has already corrupted it.
 */
export function parseShortToken(json: unknown) {
  const body = record(json);
  if (!body) return null;
  const wrapped = Array.isArray(body.data) ? record(body.data[0]) : null;
  return text((wrapped ?? body).access_token);
}

export function parseLongToken(json: unknown, now: Date) {
  const body = record(json);
  const accessToken = text(body?.access_token);
  const expiresIn = typeof body?.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : null;
  if (!accessToken || !expiresIn) return null;
  return { accessToken, expiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString() };
}

/** The account id, as the string /me returns: Instagram's `user_id`, Threads' `id`. */
export function parseMe(platform: MetaPlatform, json: unknown) {
  const body = record(json);
  const accountId = text(platform === 'instagram' ? body?.user_id : body?.id);
  const username = text(body?.username);
  return accountId && username ? { accountId, username } : null;
}

export function needsRefresh(expiresAt: string, now: Date) {
  return new Date(expiresAt).getTime() - now.getTime() < REFRESH_WITHIN_MS;
}

/** What went wrong, in terms the caller acts on. `message` is Meta's own words for a rejection. */
export function classifyMetaError(status: number, json: unknown): { kind: 'auth' | 'rejected' | 'unavailable'; message: string } {
  const error = record(record(json)?.error);
  if (error?.code === 190 || error?.code === 102 || status === 401) return { kind: 'auth', message: 'The connection needs to be renewed.' };
  if (status >= 500 || status === 429) return { kind: 'unavailable', message: 'Meta isn’t responding right now.' };
  return { kind: 'rejected', message: text(error?.error_user_msg) ?? text(error?.message) ?? 'Meta refused the request.' };
}
