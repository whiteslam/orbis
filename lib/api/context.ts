import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Claims } from '@/lib/auth/session';

/**
 * Who a /api/v1 request is for, while it runs.
 *
 * The app's server code reads the person from the session cookie. An API
 * caller has no cookie: it sends a Supabase access token instead. Rather than
 * thread that token through every repository, the API gate (lib/api/gate.ts)
 * runs the handler inside this context, and the two places that read the
 * session (lib/supabase/server.ts and the app lock) look here first. Row-level
 * security still applies: the database sees the caller's own token.
 */
export type ApiCaller = { accessToken: string; claims: Claims };

const storage = new AsyncLocalStorage<ApiCaller>();

/** The API caller this code is running for, or null outside /api/v1. */
export function apiCaller(): ApiCaller | null {
  return storage.getStore() ?? null;
}

export function runAsApiCaller<T>(caller: ApiCaller, run: () => Promise<T>): Promise<T> {
  return storage.run(caller, run);
}
