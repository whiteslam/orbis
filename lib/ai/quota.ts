/**
 * Daily AI allowances, one counter per feature.
 *
 * The Home brief, workbook advice, portfolio advice and health plans all used
 * to claim from one shared row (workbook_ai_usage), each with its own limit.
 * So a busy morning of brief rewrites used up the credits a person meant to
 * spend asking for advice. Each feature now has its own count for the day,
 * claimed atomically in Postgres before anything is sent.
 *
 * Pure apart from the injected rpc, so the rules are unit-tested.
 */
export type AiQuotaFeature = 'home_brief' | 'workbook_advice' | 'portfolio_advice' | 'health_plan';

export type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;

// PostgREST "function not in schema cache" and Postgres "undefined function":
// 202610010030_ai_feature_usage.sql has not been applied yet.
const MISSING_FUNCTION = new Set(['PGRST202', '42883']);

export async function claimAiCredit(rpc: Rpc, userId: string, feature: AiQuotaFeature, dailyLimit: number): Promise<'ok' | 'limit' | 'error'> {
  try {
    let { data, error } = await rpc('consume_ai_feature_request', { p_user_id: userId, p_feature: feature, p_daily_limit: dailyLimit });
    // Until the migration is applied, the old shared counter keeps the features working.
    if (error?.code && MISSING_FUNCTION.has(error.code)) {
      ({ data, error } = await rpc('consume_workbook_ai_request', { p_user_id: userId, p_daily_limit: dailyLimit }));
    }
    if (error) {
      console.error(`Claiming an AI credit for ${feature} failed`, error);
      return 'error';
    }
    return data === true ? 'ok' : 'limit';
  } catch {
    return 'error';
  }
}
