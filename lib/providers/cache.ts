import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { ProviderError, type Fetched, type ProviderErrorKind, type ProviderId } from '@/lib/providers/core';

// Supabase-backed cache shared by every server instance. If the cache tables
// are missing or unreachable, providers still work, just uncached.

type CacheRow = { key: string; response: unknown; expires_at: string; created_at: string };

function admin() {
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

export async function readCache(keys: string[]) {
  const rows = new Map<string, CacheRow>();
  const client = admin();
  if (!client || !keys.length) return rows;
  try {
    const { data } = await client.from('api_cache').select('key,response,expires_at,created_at').in('key', keys);
    for (const row of (data ?? []) as CacheRow[]) rows.set(row.key, row);
  } catch {
    // Cache miss is fine.
  }
  return rows;
}

export async function writeCache(provider: ProviderId, entries: Array<{ key: string; response: unknown; ttlSeconds: number }>) {
  const client = admin();
  if (!client || !entries.length) return;
  const now = Date.now();
  try {
    await client.from('api_cache').upsert(entries.map((entry) => ({
      key: entry.key,
      provider,
      response: entry.response,
      expires_at: new Date(now + entry.ttlSeconds * 1000).toISOString(),
      created_at: new Date(now).toISOString(),
    })));
  } catch {
    // Caching must never break the response.
  }
}

export async function recordProviderStatus(provider: ProviderId, outcome: 'success' | ProviderErrorKind) {
  const client = admin();
  if (!client) return;
  const now = new Date().toISOString();
  try {
    await client.from('api_provider_status').upsert(outcome === 'success'
      ? { provider, last_success_at: now }
      : { provider, last_error_at: now, last_error_kind: outcome });
  } catch {
    // Status tracking is best-effort.
  }
}

// Counts one real outbound call against the provider's daily budget.
// Returns true when allowed (or when usage tracking is not set up yet).
export async function consumeProviderCall(provider: ProviderId, dailyLimit: number) {
  const client = admin();
  if (!client) return true;
  try {
    const { data, error } = await client.rpc('consume_provider_call', { p_provider: provider, p_daily_limit: dailyLimit });
    return error ? true : Boolean(data);
  } catch {
    return true;
  }
}

export function isFresh(row: CacheRow | undefined) {
  return Boolean(row && Date.parse(row.expires_at) > Date.now());
}

// Single-key helper: fresh cache → value; otherwise load, save, and on failure
// fall back to the last saved value marked stale.
export async function cached<T>(provider: ProviderId, key: string, ttlSeconds: number, load: () => Promise<T>): Promise<Fetched<T>> {
  const row = (await readCache([key])).get(key);
  if (row && isFresh(row)) return { data: row.response as T, fetchedAt: row.created_at, stale: false };

  try {
    const data = await load();
    await Promise.all([writeCache(provider, [{ key, response: data, ttlSeconds }]), recordProviderStatus(provider, 'success')]);
    return { data, fetchedAt: new Date().toISOString(), stale: false };
  } catch (error) {
    const kind = error instanceof ProviderError ? error.kind : 'unavailable';
    await recordProviderStatus(provider, kind);
    if (row) return { data: row.response as T, fetchedAt: row.created_at, stale: true };
    throw error instanceof ProviderError ? error : new ProviderError(provider, 'unavailable');
  }
}
