import 'server-only';

import { currentBudget, monthSpendUsd } from '@/lib/ai/budget';
import { monthStartIso } from '@/lib/ai/policy';
import { summariseUsage, type UsageRow, type UsageSummary } from '@/lib/ai/usage';
import { createAdminClient } from '@/lib/supabase/admin';

/** Plenty for one person's month of attempts; the panel is a summary, not a ledger. */
const MAX_ROWS = 10_000;

/**
 * The viewer's own AI attempts this month, plus the month's whole bill against
 * the budget. Null when the telemetry tables cannot be read at all.
 */
export async function getAiUsage(userId: string): Promise<UsageSummary | null> {
  try {
    const admin = createAdminClient();
    const since = monthStartIso(new Date());
    const [events, paidModels, totalUsd] = await Promise.all([
      admin.from('ai_generation_events')
        .select('provider_id,model_id,outcome,attempt,duration_ms,input_tokens,output_tokens,cost_usd')
        .eq('user_id', userId).gte('created_at', since).limit(MAX_ROWS),
      admin.from('ai_models').select('provider_id,model_id').eq('is_free', false),
      monthSpendUsd(admin),
    ]);
    // Before the token and cost migrations, there is nothing to summarise yet.
    if (events.error) return null;
    const rows: UsageRow[] = (events.data ?? []).map((row) => ({
      providerId: String(row.provider_id ?? ''),
      modelId: String(row.model_id ?? ''),
      outcome: String(row.outcome),
      attempt: typeof row.attempt === 'number' ? row.attempt : null,
      durationMs: Number(row.duration_ms) || 0,
      inputTokens: typeof row.input_tokens === 'number' ? row.input_tokens : null,
      outputTokens: typeof row.output_tokens === 'number' ? row.output_tokens : null,
      costUsd: row.cost_usd === null || row.cost_usd === undefined ? null : Number(row.cost_usd),
    }));
    const paid = (paidModels.data ?? []).map((model) => `${model.provider_id}/${model.model_id}`);
    return summariseUsage(rows, paid, currentBudget(), new Date(), totalUsd);
  } catch {
    return null;
  }
}
