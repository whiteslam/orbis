import 'server-only';

import { budgetConfig, monthStartIso } from '@/lib/ai/policy';
import type { createAdminClient } from '@/lib/supabase/admin';

type Admin = ReturnType<typeof createAdminClient>;

/** Long enough that a burst of requests reads the total once, short enough to notice a busy hour. */
const CACHE_MS = 60_000;

let cached: { since: string; usd: number; at: number } | null = null;

export function currentBudget() {
  return budgetConfig(process.env);
}

/**
 * Dollars spent on AI since the budget month began, or null when that cannot be
 * known (the paid-models migration is not applied, or the read failed). The
 * router treats null as "spent": no paid model runs on a guess.
 */
export async function monthSpendUsd(admin: Admin, now = new Date()): Promise<number | null> {
  const since = monthStartIso(now);
  if (cached && cached.since === since && Date.now() - cached.at < CACHE_MS) return cached.usd;
  try {
    const { data, error } = await admin.rpc('ai_spend_since', { p_since: since });
    const usd = Number(data);
    if (error || !Number.isFinite(usd)) return null;
    cached = { since, usd, at: Date.now() };
    return usd;
  } catch {
    return null;
  }
}

/** A paid attempt just finished: count it now rather than after the cache expires. */
export function noteSpend(usd: number) {
  if (cached && usd > 0) cached = { ...cached, usd: cached.usd + usd };
}
