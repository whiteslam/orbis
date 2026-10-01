/**
 * One adapter per API style a provider can speak (ai_providers.api_style).
 *
 * The router decides who to ask and in what order; an adapter only knows how to
 * ask one model and report what happened, in the same terms whichever provider
 * it is. Adding a provider with a new API (Jev, for instance, once its API is
 * documented) means one new adapter and one new api_style value, nothing in a
 * feature.
 */
import type { Completion, TokenUsage } from '@/lib/ai/attempt';

export type AdapterRequest = {
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
  /** Aborts at this attempt's share of the request's deadline. */
  signal: AbortSignal;
  accept?: (text: string) => boolean;
};

export type AdapterTarget = {
  modelId: string;
  baseUrl: string;
  apiKey: string;
  /** Provider-specific body options from the registry, such as reasoning effort. */
  extra: Record<string, unknown>;
};

export type FailureOutcome = 'rate_limited' | 'auth_failed' | 'not_found' | 'failed' | 'timeout';

export type AdapterResult =
  | { outcome: 'succeeded'; status: number; text: string; usage: TokenUsage | null; bytes: number }
  | { outcome: 'invalid_output'; status: number; usage: TokenUsage | null; bytes: number }
  | { outcome: FailureOutcome; status: number | null };

export type Adapter = (target: AdapterTarget, request: AdapterRequest) => Promise<AdapterResult>;

/** An HTTP error status in the router's terms. */
export function failureFor(status: number): FailureOutcome {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'auth_failed';
  if (status === 404) return 'not_found';
  return 'failed';
}

/** A parsed reply as an adapter result. */
export function resultOf(reply: Completion, status: number, bytes: number): AdapterResult {
  return reply.kind === 'ok'
    ? { outcome: 'succeeded', status, text: reply.text, usage: reply.usage, bytes }
    : { outcome: 'invalid_output', status, usage: reply.usage, bytes };
}

export function isTimeout(error: unknown) {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}
