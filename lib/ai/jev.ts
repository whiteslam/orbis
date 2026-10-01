import 'server-only';

import { currentBudget, monthSpendUsd, noteSpend } from '@/lib/ai/budget';
import { aiAllowed } from '@/lib/ai/consent';
import { getAiConsent } from '@/lib/ai/consent-store';
import { DEPTHS, questionDepthRequest, readDecision, type Decision } from '@/lib/ai/decide';
import { later, recordAiEvent } from '@/lib/ai/events';
import { failureFor } from '@/lib/ai/adapters/types';
import { budgetState } from '@/lib/ai/policy';
import { createAdminClient } from '@/lib/supabase/admin';

const SYSTEM_ONE_URL = 'https://openrouter.ai/api/v1/systemone';
/** Jev answers in well under a second; past this the question goes ahead on the mode's rule. */
const TIMEOUT_MS = 4_000;

/** The Jev release to ask. Pinned by default so a new release cannot change routing unannounced. */
const jevModel = () => process.env.ORBIS_JEV_MODEL?.trim() || 'typesafe/jev-1.13';

function jevEnabled() {
  return process.env.ORBIS_JEV?.trim() !== 'off' && Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

/**
 * Whether a question needs reasoning, in Jev's judgement: true puts Claude
 * first for this one request, false keeps free models first, undefined (Jev
 * off, unsure, unreachable, or the budget spent) leaves it to the budget mode.
 *
 * Only the question is sent, never the records it will be answered from, and
 * only after the person has turned AI on. It costs about $0.00002 and is
 * logged and counted against the budget like any paid call.
 */
export async function needsReasoning(userId: string, question: string, feature: string): Promise<boolean | undefined> {
  if (!jevEnabled()) return undefined;
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return undefined;
  }
  if (!aiAllowed(await getAiConsent(userId))) return undefined;
  // With the budget spent Claude cannot run anyway, so there is nothing to decide.
  const config = currentBudget();
  const spent = await monthSpendUsd(admin);
  if (config.monthlyInr === 0 || spent === null || budgetState(spent, config) === 'critical') return undefined;

  const model = jevModel();
  const startedAt = Date.now();
  let status: number | null = null;
  let outcome = 'failed';
  let decision: Decision | null = null;
  try {
    const response = await fetch(SYSTEM_ONE_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.OPENROUTER_API_KEY?.trim() ?? ''}`, 'content-type': 'application/json' },
      body: JSON.stringify(questionDepthRequest(model, question)),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = response.status;
    if (!response.ok) {
      outcome = failureFor(response.status);
    } else {
      decision = readDecision(await response.json().catch(() => null), 'depth', DEPTHS);
      outcome = decision?.choice ? 'succeeded' : 'invalid_output';
    }
  } catch (error) {
    outcome = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : 'failed';
  }

  const costUsd = decision?.costUsd ?? null;
  if (costUsd) noteSpend(costUsd);
  const base = {
    user_id: userId,
    feature: `${feature}_routing`.slice(0, 40),
    model: model.slice(0, 120),
    provider_id: 'openrouter',
    model_id: model,
    sensitivity: 'personal',
    attempt: 1,
    outcome,
    provider_status: status,
    duration_ms: Math.min(Date.now() - startedAt, 120_000),
    response_bytes: 0,
  };
  const withTokens = decision?.usage ? { ...base, input_tokens: decision.usage.inputTokens, output_tokens: decision.usage.outputTokens } : base;
  later(() => recordAiEvent(admin, [costUsd === null ? withTokens : { ...withTokens, cost_usd: costUsd }, withTokens, base]));

  if (decision?.choice === 'reasoning') return true;
  if (decision?.choice === 'lookup') return false;
  return undefined;
}
