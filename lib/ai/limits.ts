import type { AiQuotaFeature } from '@/lib/ai/quota';
import type { createAdminClient } from '@/lib/supabase/admin';

/**
 * How many times a day each AI feature may be used, per account plan.
 *
 * FALLBACK_LIMITS is what every feature allowed before plans existed, and it is
 * the one place those numbers live. Anyone without a plan row, and any failure
 * to read one, gets exactly these. A plan (public.plans.limits) overrides them
 * feature by feature; a feature it leaves out keeps its fallback.
 *
 * The pure rules sit here with only type imports, so tests can load them
 * without the server.
 */
export type PlanLimits = Partial<Record<AiQuotaFeature, number>>;

export const FALLBACK_LIMITS: Readonly<Record<AiQuotaFeature, number>> = {
  ask_orbis: 20,
  home_brief: 8,
  portfolio_news: 4,
  workbook_advice: 5,
  health_plan: 10,
  portfolio_advice: 5,
  // The crons read hundreds of jobs and emails a day; these only stop a runaway loop.
  career_profile: 30,
  career_spec: 40,
  career_requirements: 800,
  career_tailor: 80,
  career_alerts: 300,
  career_mail: 300,
  career_offer: 30,
  career_prep: 40,
  career_followup: 100,
};

/**
 * The most the claim functions in Postgres will accept as p_daily_limit; above
 * it they refuse the request outright. consume_ask_orbis_request
 * (202609280303_ask_orbis_usage.sql) caps at 50; consume_ai_feature_request
 * (latest: 202610270002_career_followup.sql) caps at 1000. A plan's value is
 * clamped to this so a generous plan raises the limit instead of locking
 * the person out.
 */
export const RPC_CAPS: Readonly<Record<AiQuotaFeature, number>> = {
  ask_orbis: 50,
  home_brief: 1000,
  portfolio_news: 1000,
  workbook_advice: 1000,
  health_plan: 1000,
  portfolio_advice: 1000,
  career_profile: 1000,
  career_spec: 1000,
  career_requirements: 1000,
  career_tailor: 1000,
  career_alerts: 1000,
  career_mail: 1000,
  career_offer: 1000,
  career_prep: 1000,
  career_followup: 1000,
};

/** The plan's value (at most the claim function's cap) when it is a positive whole number, else the fallback. */
export function limitFor(feature: AiQuotaFeature, plan: PlanLimits | null): number {
  const value = plan?.[feature];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? Math.min(value, RPC_CAPS[feature]) : FALLBACK_LIMITS[feature];
}

type Admin = ReturnType<typeof createAdminClient>;

const DEFAULT_PLAN = 'free';

function asLimits(value: unknown): PlanLimits | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as PlanLimits) : null;
}

/** The plan embedded in an account_plans read: an object (many-to-one), or a one-item list from an older PostgREST. */
function embeddedLimits(row: unknown): PlanLimits | null {
  const plans = (row as { plans?: unknown } | null)?.plans;
  const plan = Array.isArray(plans) ? plans[0] : plans;
  return asLimits((plan as { limits?: unknown } | null | undefined)?.limits);
}

/**
 * Today's allowance for one feature, from the person's plan (the 'free' plan
 * when they have no row). One read when they have a row: the plan's limits
 * come embedded in it; a second read of 'free' only when they don't. Any
 * error, a missing table included, gives the fallback, so this never blocks a
 * feature that worked before.
 */
export async function dailyLimit(admin: Admin, userId: string, feature: AiQuotaFeature): Promise<number> {
  try {
    const account = await admin.from('account_plans').select('plans(limits)').eq('user_id', userId).maybeSingle();
    if (account.error) return FALLBACK_LIMITS[feature];
    if (account.data) return limitFor(feature, embeddedLimits(account.data));
    const free = await admin.from('plans').select('limits').eq('id', DEFAULT_PLAN).maybeSingle();
    if (free.error) return FALLBACK_LIMITS[feature];
    return limitFor(feature, asLimits(free.data?.limits));
  } catch {
    return FALLBACK_LIMITS[feature];
  }
}
