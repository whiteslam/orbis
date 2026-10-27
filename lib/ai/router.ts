import 'server-only';

import { ADAPTERS } from '@/lib/ai/adapters';
import type { AdapterResult } from '@/lib/ai/adapters/types';
import type { TokenUsage } from '@/lib/ai/attempt';
import { currentBudget, monthSpendUsd, noteSpend } from '@/lib/ai/budget';
import { aiAllowed } from '@/lib/ai/consent';
import { later, MISSING_COLUMN, recordAiEvent } from '@/lib/ai/events';
import { getAiConsent } from '@/lib/ai/consent-store';
import {
  attemptCostUsd, budgetCapped, budgetState, capAttempts, orderCandidates, paidAffordable, worstCaseCostUsd,
  type BudgetConfig, type BudgetState, type Priced,
} from '@/lib/ai/policy';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * The AI router the registry was designed for.
 *
 * `ai_providers` and `ai_models` hold priorities, free-tier flags and prices;
 * this reads them so no feature hard-codes a model.
 *
 * Sensitivity is still carried on every request and logged, but it no longer
 * narrows the providers: the owner lifted the rule that personal data may only
 * reach providers that don't train on it (2026-10-27), choosing the most
 * capable model over the most private one. Restoring it means filtering
 * candidates() on may_train again.
 *
 * Money decides the order. Free models are always allowed; paid ones run first
 * for quality features, and only within a cap when the environment sets one
 * (lib/ai/policy.ts). How each provider is actually called lives in
 * lib/ai/adapters.
 */
export type Sensitivity = 'personal' | 'general';

export type RouterRequest = {
  userId: string;
  feature: string;
  sensitivity: Sensitivity;
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs?: number;
  /** Lower for work that must stick to the supplied numbers. Defaults to 0.4. */
  temperature?: number;
  /**
   * Whether a reply is usable, usually "does it parse". A reply that is not is
   * logged as invalid_output and the next model is tried, instead of the whole
   * request failing on one model's broken JSON.
   */
  accept?: (text: string) => boolean;
  /**
   * A verdict about this request from Jev (lib/ai/jev.ts): true when it needs
   * reasoning, so Claude goes first; false when it is a simple lookup, so free
   * models go first. Undefined leaves it to the budget mode.
   */
  escalate?: boolean;
};

export type RouterResult = { text: string; providerId: string; modelId: string } | null;

type Admin = ReturnType<typeof createAdminClient>;

type Candidate = Priced & {
  providerId: string;
  modelId: string;
  baseUrl: string;
  apiKeyEnv: string;
  apiStyle: string;
  mayTrain: boolean;
  /** Provider-specific body options from the registry, such as reasoning effort. */
  extra: Record<string, unknown>;
};

const FAILURE_COOLDOWN_MINUTES = 15;
const MAX_ATTEMPTS = 4;
const DEFAULT_TIMEOUT_MS = 15_000;
// One budget for the whole request, however many models it falls through, so
// the worst case stays inside the 60 s function limit.
const MAX_TOTAL_MS = 50_000;
// Less than this left is not enough for a model to answer; stop and let the
// caller use its own wording.
const MIN_ATTEMPT_MS = 1_500;
/**
 * The largest prompt a paid model is sent, about 30,000 tokens. Every caller
 * already caps its own input well below this (Ask Orbis at 60 KB); this is the
 * backstop against a future caller that does not.
 */
const MAX_PAID_PROMPT_CHARS = 120_000;

/**
 * The registry says which secret to send and where to send it, so a bad row
 * (a typo, or a write to the table) could post a real API key, or the user's
 * data, to any server. Code decides which secrets and hosts are possible at all;
 * the registry only chooses among them. These match the providers seeded in
 * 202609240018_ai_registry.sql and 202610010031_ai_paid_models.sql.
 */
const ALLOWED_KEY_ENVS = new Set(['GROQ_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'MISTRAL_API_KEY', 'ANTHROPIC_API_KEY']);
const ALLOWED_HOSTS = new Set(['api.groq.com', 'openrouter.ai', 'generativelanguage.googleapis.com', 'api.mistral.ai', 'api.anthropic.com']);

function providerAllowed(apiKeyEnv: unknown, baseUrl: unknown) {
  if (typeof apiKeyEnv !== 'string' || !ALLOWED_KEY_ENVS.has(apiKeyEnv) || typeof baseUrl !== 'string') return false;
  try {
    const url = new URL(baseUrl);
    return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.host);
  } catch {
    return false;
  }
}

const PROVIDER_COLUMNS = 'id,base_url,api_key_env,enabled,priority,may_train,cooldown_until,request_extra';
const MODEL_COLUMNS = 'provider_id,model_id,enabled,is_free,priority,may_train,cooldown_until,supports_json,request_extra';

/**
 * The registry rows. Before 202610010031_ai_paid_models.sql there are no prices
 * or API styles, so only free models are read, exactly as before.
 */
async function registry(admin: Admin) {
  const [providers, models] = await Promise.all([
    admin.from('ai_providers').select(`${PROVIDER_COLUMNS},api_style`).eq('enabled', true),
    admin.from('ai_models').select(`${MODEL_COLUMNS},input_usd_per_mtok,output_usd_per_mtok`).eq('enabled', true),
  ]);
  if (!MISSING_COLUMN.has(providers.error?.code ?? '') && !MISSING_COLUMN.has(models.error?.code ?? '')) return { providers, models };
  const [oldProviders, oldModels] = await Promise.all([
    admin.from('ai_providers').select(PROVIDER_COLUMNS).eq('enabled', true),
    admin.from('ai_models').select(MODEL_COLUMNS).eq('enabled', true).eq('is_free', true),
  ]);
  return { providers: oldProviders, models: oldModels };
}

const price = (value: unknown) => (value === null || value === undefined || value === '' ? null : Number(value));

type Row = Record<string, unknown>;

/** Whether this provider and model can be called at all right now: JSON, a known host and adapter, no cooldown. */
function callable(provider: Row, model: Row, apiStyle: string, now: string) {
  if (model.supports_json === false) return false;
  if (!providerAllowed(provider.api_key_env, provider.base_url)) return false;
  if (!ADAPTERS[apiStyle]) return false;
  if (provider.cooldown_until && (provider.cooldown_until as string) > now) return false;
  return !(model.cooldown_until && (model.cooldown_until as string) > now);
}

/** A model's prices per million tokens, or null for a paid model with no price, which could spend money nobody can see. */
function pricing(model: Row): Pick<Candidate, 'paid' | 'inputUsdPerMTok' | 'outputUsdPerMTok'> | null {
  const paid = model.is_free !== true;
  if (!paid) return { paid, inputUsdPerMTok: 0, outputUsdPerMTok: 0 };
  const inputPrice = price(model.input_usd_per_mtok);
  const outputPrice = price(model.output_usd_per_mtok);
  if (!(Number.isFinite(inputPrice) && Number.isFinite(outputPrice))) return null;
  return { paid, inputUsdPerMTok: inputPrice!, outputUsdPerMTok: outputPrice! };
}

/**
 * Every model that could serve a request right now, free or paid, with
 * the registry's own order (provider priority, then model priority). Whether a
 * paid one may actually run is the budget's call, in plan().
 */
async function candidates(admin: Admin): Promise<Candidate[]> {
  const now = new Date().toISOString();
  const { providers, models } = await registry(admin);
  if (providers.error || models.error) return [];

  const rows = (data: unknown) => (data ?? []) as Row[];
  const byId = new Map(rows(providers.data).map((provider) => [provider.id as string, provider]));
  return rows(models.data).flatMap((model): Candidate[] => {
    const provider = byId.get(model.provider_id as string);
    if (!provider) return [];
    const apiStyle = typeof provider.api_style === 'string' ? provider.api_style : 'openai';
    if (!callable(provider, model, apiStyle, now)) return [];
    // A model may override its provider's training stance; kept for the log.
    const mayTrain = model.may_train ?? provider.may_train;
    // A model may override its provider's options entirely: null inherits,
    // {} deliberately sends none. Groq needs reasoning_effort for GPT-OSS
    // and must not send it to Qwen, which reasons harder when it sees it.
    const extra = (model.request_extra ?? provider.request_extra ?? {}) as Record<string, unknown>;
    if (!process.env[provider.api_key_env as string]?.trim()) return [];
    const cost = pricing(model);
    if (!cost) return [];
    return [{
      id: `${model.provider_id}/${model.model_id}`,
      order: (provider.priority as number) * 1000 + (model.priority as number),
      ...cost,
      providerId: model.provider_id as string,
      modelId: model.model_id as string,
      baseUrl: provider.base_url as string,
      apiKeyEnv: provider.api_key_env as string,
      apiStyle,
      mayTrain: mayTrain === true,
      extra,
    }];
  });
}

/**
 * Who to ask, in order, given this month's spend. The spend is only read when a
 * paid model is in play; when it cannot be read, paid models sit this one out.
 */
async function plan(admin: Admin, feature: string, escalate?: boolean) {
  const all = await candidates(admin);
  const config = currentBudget();
  // Without a cap the spend decides nothing, so it isn't read.
  const capped = budgetCapped(config);
  const spentUsd = capped && all.some((candidate) => candidate.paid) ? await monthSpendUsd(admin) : 0;
  const state: BudgetState = spentUsd === null ? 'critical' : budgetState(spentUsd, config);
  const ordered = capAttempts(orderCandidates(all, { feature, paidRouting: config.paidRouting, state, escalate }), MAX_ATTEMPTS);
  return { ordered, spentUsd: spentUsd ?? Number.POSITIVE_INFINITY, config };
}

async function logAttempt(admin: Admin, request: RouterRequest, candidate: Candidate, attempt: number, result: AdapterResult, durationMs: number, costUsd: number | null) {
  const usage: TokenUsage | null = 'usage' in result ? result.usage : null;
  const base: Record<string, unknown> = {
    user_id: request.userId,
    feature: request.feature,
    model: candidate.id.slice(0, 120),
    provider_id: candidate.providerId,
    model_id: candidate.modelId,
    sensitivity: request.sensitivity,
    // Second or later means every model before it failed: the fallback rate.
    attempt,
    outcome: result.outcome,
    provider_status: result.status,
    duration_ms: Math.min(durationMs, 120_000),
    response_bytes: Math.min('bytes' in result ? result.bytes : 0, 131_072),
  };
  const withTokens = usage ? { ...base, input_tokens: usage.inputTokens, output_tokens: usage.outputTokens } : base;
  const withCost = costUsd === null ? withTokens : { ...withTokens, cost_usd: costUsd };
  await recordAiEvent(admin, [withCost, withTokens, base]);
}

/** A model that just failed stands down briefly, so one bad model is not tried first every time. */
async function penalise(admin: Admin, candidate: Candidate, hard: boolean) {
  try {
    await admin.from('ai_models').update({
      cooldown_until: hard ? new Date(Date.now() + FAILURE_COOLDOWN_MINUTES * 60_000).toISOString() : null,
      last_seen: new Date().toISOString(),
    }).eq('provider_id', candidate.providerId).eq('model_id', candidate.modelId);
  } catch {
    // Bookkeeping only.
  }
}

/** Whether a paid model may take this request: the prompt is within the cap and its worst case fits what is left of the month. */
function paidFits(request: RouterRequest, promptChars: number, candidate: Candidate, spentUsd: number, config: BudgetConfig) {
  return promptChars <= MAX_PAID_PROMPT_CHARS && paidAffordable({ promptChars, maxTokens: request.maxTokens }, candidate, spentUsd, config);
}

/** One attempt at one model, with its own timeout. */
function callModel(request: RouterRequest, candidate: Candidate, timeoutMs: number) {
  return ADAPTERS[candidate.apiStyle]({
    modelId: candidate.modelId,
    baseUrl: candidate.baseUrl,
    apiKey: process.env[candidate.apiKeyEnv]?.trim() ?? '',
    extra: candidate.extra,
  }, {
    system: request.system,
    user: request.user,
    temperature: request.temperature ?? 0.4,
    maxTokens: request.maxTokens,
    // Each attempt gets its own timeout, but never more than what is left overall.
    signal: AbortSignal.timeout(timeoutMs),
    accept: request.accept,
  });
}

/**
 * What an attempt cost. A paid reply that did not report usage is booked at its
 * worst case, so the budget errs towards stopping early rather than overspending.
 */
function attemptCost(result: AdapterResult, candidate: Candidate, promptChars: number, maxTokens: number) {
  if (!candidate.paid) return 0;
  const usage = 'usage' in result ? result.usage : null;
  if (usage) return attemptCostUsd(usage, candidate);
  return 'bytes' in result ? worstCaseCostUsd(promptChars, maxTokens, candidate) : null;
}

/**
 * Asks the best available model for JSON, falling through the registry on
 * failure. Returns null when every candidate is exhausted, which is the
 * caller's signal to use its own wording rather than to show an error.
 *
 * Consent comes first. Until the person has turned AI on (and so seen what is
 * sent, and where), nothing reaches any provider, whoever the caller is: an
 * action, the Home brief, or the notification cron. Callers that need to tell
 * "off" apart from "no model" ask lib/ai/gate.ts before they get here.
 *
 * Then money: a paid model is skipped when this request's worst case would not
 * fit in what is left of the month.
 */
export async function routeJson(request: RouterRequest): Promise<RouterResult> {
  let admin: Admin;
  try {
    admin = createAdminClient();
  } catch {
    return null;
  }

  if (!aiAllowed(await getAiConsent(request.userId))) return null;

  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + Math.min(timeoutMs * 1.5, MAX_TOTAL_MS);
  const promptChars = request.system.length + request.user.length;
  const { ordered, spentUsd, config } = await plan(admin, request.feature, request.escalate);
  let attempt = 0;
  for (const candidate of ordered) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_ATTEMPT_MS) break;
    if (candidate.paid && !paidFits(request, promptChars, candidate, spentUsd, config)) continue;

    attempt += 1;
    const thisAttempt = attempt;
    const startedAt = Date.now();
    const result = await callModel(request, candidate, Math.min(timeoutMs, remaining)); // NOSONAR: models are tried in order until one answers
    const durationMs = Date.now() - startedAt;

    const costUsd = attemptCost(result, candidate, promptChars, request.maxTokens);
    if (costUsd) noteSpend(costUsd);
    const hard = result.outcome === 'failed' || result.outcome === 'auth_failed' || result.outcome === 'not_found';
    later(async () => {
      await logAttempt(admin, request, candidate, thisAttempt, result, durationMs, costUsd);
      await penalise(admin, candidate, hard);
    });

    if (result.outcome === 'succeeded') return { text: result.text, providerId: candidate.providerId, modelId: candidate.modelId };
  }
  return null;
}

/** Whether any model could serve a request right now, budget included, for settings copy. */
export async function routerAvailable() {
  try {
    return (await plan(createAdminClient(), 'availability')).ordered.length > 0;
  } catch {
    return false;
  }
}
