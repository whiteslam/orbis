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

/** The plan's value when it is a positive whole number, else the fallback. */
export function limitFor(feature: AiQuotaFeature, plan: PlanLimits | null): number {
  const value = plan?.[feature];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : FALLBACK_LIMITS[feature];
}

type Admin = ReturnType<typeof createAdminClient>;

const DEFAULT_PLAN = 'free';

function asLimits(value: unknown): PlanLimits | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as PlanLimits) : null;
}

/**
 * Today's allowance for one feature, from the person's plan (the 'free' plan
 * when they have no row). Any error, a missing table included, gives the
 * fallback, so this never blocks a feature that worked before.
 */
export async function dailyLimit(admin: Admin, userId: string, feature: AiQuotaFeature): Promise<number> {
  try {
    const account = await admin.from('account_plans').select('plan_id').eq('user_id', userId).maybeSingle();
    if (account.error) return FALLBACK_LIMITS[feature];
    const planId = typeof account.data?.plan_id === 'string' ? account.data.plan_id : DEFAULT_PLAN;
    const plan = await admin.from('plans').select('limits').eq('id', planId).maybeSingle();
    if (plan.error) return FALLBACK_LIMITS[feature];
    return limitFor(feature, asLimits(plan.data?.limits));
  } catch {
    return FALLBACK_LIMITS[feature];
  }
}
