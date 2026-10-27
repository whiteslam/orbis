import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { anonLimitsFor, limitFor, RATE_LIMIT_UNAVAILABLE_MESSAGE, rateLimitMessage, type AnonRateBucket, type RateBucket } from '@/lib/security/rate-limit-rules';
import { ANON_GLOBAL_KEY } from '@/lib/security/anon-rate-key';

export { RATE_LIMITS, rateLimitMessage, type RateBucket } from '@/lib/security/rate-limit-rules';

export type RateLimitOutcome = 'ok' | 'limited' | 'unavailable';

/**
 * Counts one use of `bucket` for this person. The database does the check and the
 * increment in one statement, so parallel requests can't slip past the limit.
 */
export async function consumeRateLimit(userId: string, bucket: RateBucket): Promise<RateLimitOutcome> {
  const { limit, windowSeconds } = limitFor(bucket);
  try {
    const { data, error } = await createAdminClient().rpc('consume_rate_limit', {
      p_user_id: userId,
      p_bucket: bucket,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.error('consume_rate_limit failed', error);
      return 'unavailable';
    }
    return data === true ? 'ok' : 'limited';
  } catch (error) {
    console.error('consume_rate_limit failed', error);
    return 'unavailable';
  }
}

/** The message for a refused request, or null when it may go ahead. Fails closed. */
export async function rateLimitRefusal(userId: string, bucket: RateBucket): Promise<string | null> {
  const outcome = await consumeRateLimit(userId, bucket);
  if (outcome === 'ok') return null;
  return outcome === 'limited' ? rateLimitMessage(bucket) : RATE_LIMIT_UNAVAILABLE_MESSAGE;
}

/**
 * Counts one signed-out use of `bucket` against the caller's address key, then
 * against everyone, so a refused address doesn't go on spending the global
 * budget. True only when both allow it; fails closed.
 */
export async function anonRateLimitAllows(addressKey: string, bucket: AnonRateBucket): Promise<boolean> {
  const { perAddress, global } = anonLimitsFor(bucket);
  for (const [key, { limit, windowSeconds }] of [[addressKey, perAddress], [ANON_GLOBAL_KEY, global]] as const) {
    try {
      const { data, error } = await createAdminClient().rpc('consume_anon_rate_limit', {
        p_key: key,
        p_bucket: bucket,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      });
      if (error) {
        console.error('consume_anon_rate_limit failed', error);
        return false;
      }
      if (data !== true) return false;
    } catch (error) {
      console.error('consume_anon_rate_limit failed', error);
      return false;
    }
  }
  return true;
}
