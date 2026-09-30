import 'server-only';

import type { MetaRequest } from '@/lib/meta/requests';
import { classifyMetaError } from '@/lib/meta/tokens';

const TIMEOUT_MS = 8_000;

export class MetaError extends Error {
  constructor(readonly kind: 'auth' | 'rejected' | 'unavailable', message: string) {
    super(message);
    this.name = 'MetaError';
  }
}

/**
 * Runs one Meta request. The URL carries a token (and for the token exchange,
 * the app secret), so it is never logged: failures are reported by kind only.
 */
export async function callMeta(request: MetaRequest): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(request.url, {
      method: request.method,
      body: request.body,
      headers: request.body ? { 'content-type': 'application/x-www-form-urlencoded' } : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new MetaError('unavailable', 'Meta isn’t responding right now.');
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // An empty or non-JSON body is classified by status alone.
  }
  if (!response.ok || (json && typeof json === 'object' && 'error' in json)) {
    const problem = classifyMetaError(response.ok ? 400 : response.status, json);
    throw new MetaError(problem.kind, problem.message);
  }
  return (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
}
