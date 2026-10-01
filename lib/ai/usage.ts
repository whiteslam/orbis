/**
 * This month's AI use, summarised for the settings panel. Pure; the rows come
 * from ai_generation_events (one per attempt) through lib/ai/usage-store.ts.
 */
import { budgetState, monthStartIso, type BudgetConfig, type BudgetState } from '@/lib/ai/policy';

export type UsageRow = {
  providerId: string;
  modelId: string;
  outcome: string;
  /** Which model in the request's order this was; 2 or more means an earlier one failed. */
  attempt: number | null;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
};

type Tally = { calls: number; failed: number; tokens: number };

export type UsageSummary = {
  free: Tally;
  paid: Tally;
  /** Answers that came from a second or later model. */
  fallbacks: number;
  averageLatencyMs: number | null;
  spentInr: number;
  budgetInr: number;
  /** The month's spend if the pace so far continues. */
  projectedInr: number;
  state: BudgetState;
};

const paise = (value: number) => Math.round(value * 100) / 100;

function nextMonthStart(now: Date) {
  const start = new Date(monthStartIso(now));
  // Past the next 1st whatever the month's length, then back to that 1st.
  return new Date(monthStartIso(new Date(start.getTime() + 32 * 86_400_000)));
}

/**
 * A call is paid when it cost something or its model is a paid one (a failed
 * Claude call costs nothing but is still a Claude call). One provider can host
 * both kinds, so it is judged per model: `paidModels` are "provider/model" ids.
 * `totalSpentUsd` is the whole bill when it is known: the budget is the
 * owner's, while `rows` may be only the viewer's own attempts.
 */
export function summariseUsage(rows: UsageRow[], paidModels: string[], config: BudgetConfig, now = new Date(), totalSpentUsd?: number | null): UsageSummary {
  const paidSet = new Set(paidModels);
  const free: Tally = { calls: 0, failed: 0, tokens: 0 };
  const paid: Tally = { calls: 0, failed: 0, tokens: 0 };
  let spentUsd = 0;
  let fallbacks = 0;
  let answered = 0;
  let latency = 0;
  for (const row of rows) {
    const tally = (row.costUsd ?? 0) > 0 || paidSet.has(`${row.providerId}/${row.modelId}`) ? paid : free;
    tally.calls += 1;
    tally.tokens += (row.inputTokens ?? 0) + (row.outputTokens ?? 0);
    spentUsd += row.costUsd ?? 0;
    if (row.outcome === 'succeeded') {
      answered += 1;
      latency += row.durationMs;
      if ((row.attempt ?? 1) > 1) fallbacks += 1;
    } else {
      tally.failed += 1;
    }
  }

  const start = new Date(monthStartIso(now)).getTime();
  const elapsed = Math.max(now.getTime() - start, 1) / (nextMonthStart(now).getTime() - start);
  const billUsd = typeof totalSpentUsd === 'number' ? totalSpentUsd : spentUsd;
  const spentInr = paise(billUsd * config.usdInr);
  return {
    free,
    paid,
    fallbacks,
    averageLatencyMs: answered ? Math.round(latency / answered) : null,
    spentInr,
    budgetInr: config.monthlyInr,
    projectedInr: paise(spentInr / Math.min(elapsed, 1)),
    state: budgetState(billUsd, config),
  };
}
