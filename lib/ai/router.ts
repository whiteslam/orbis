import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * The AI router the registry was designed for.
 *
 * `ai_providers` and `ai_models` were seeded with priorities, free-tier flags
 * and a `may_train` column, and then nothing read them: the notification writer
 * hard-coded two Groq models and the Home brief called OpenRouter directly.
 * That mattered, because the registry marks Groq as the only provider that will
 * not train on what it is sent, and the brief was sending spending totals and a
 * portfolio to one that will.
 *
 * So sensitivity is the first filter here, not a comment. A 'personal' request
 * can only ever reach a provider whose may_train is false; if none is
 * available, the caller gets null and falls back to wording Orbis wrote itself.
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
};

export type RouterResult = { text: string; providerId: string; modelId: string } | null;

type Admin = ReturnType<typeof createAdminClient>;

type Candidate = {
  providerId: string;
  modelId: string;
  baseUrl: string;
  apiKeyEnv: string;
  mayTrain: boolean;
  /** Provider-specific body options from the registry, such as reasoning effort. */
  extra: Record<string, unknown>;
};

const FAILURE_COOLDOWN_MINUTES = 15;
const MAX_ATTEMPTS = 4;

/**
 * Models the router may use right now, best first.
 *
 * Ordered by provider priority then model priority, so the registry's own
 * ranking decides, not this file.
 */
async function candidates(admin: Admin, sensitivity: Sensitivity): Promise<Candidate[]> {
  const now = new Date().toISOString();
  const [providers, models] = await Promise.all([
    admin.from('ai_providers').select('id,base_url,api_key_env,enabled,priority,may_train,cooldown_until,request_extra').eq('enabled', true),
    admin.from('ai_models').select('provider_id,model_id,enabled,is_free,priority,may_train,cooldown_until,supports_json,request_extra').eq('enabled', true).eq('is_free', true),
  ]);
  if (providers.error || models.error) return [];

  const byId = new Map((providers.data ?? []).map((provider) => [provider.id as string, provider]));
  return (models.data ?? [])
    .flatMap((model) => {
      const provider = byId.get(model.provider_id as string);
      if (!provider || model.supports_json === false) return [];
      if (provider.cooldown_until && provider.cooldown_until > now) return [];
      if (model.cooldown_until && model.cooldown_until > now) return [];
      // A model may override its provider's training stance; the stricter of the two wins.
      const mayTrain = model.may_train ?? provider.may_train;
      if (sensitivity === 'personal' && mayTrain !== false) return [];
      if (!process.env[provider.api_key_env as string]?.trim()) return [];
      return [{
        providerId: model.provider_id as string,
        modelId: model.model_id as string,
        baseUrl: provider.base_url as string,
        apiKeyEnv: provider.api_key_env as string,
        mayTrain: mayTrain === true,
        // A model may override its provider's options entirely: null inherits,
        // {} deliberately sends none. Groq needs reasoning_effort for GPT-OSS
        // and must not send it to Qwen, which reasons harder when it sees it.
        extra: (model.request_extra ?? provider.request_extra ?? {}) as Record<string, unknown>,
        order: (provider.priority as number) * 1000 + (model.priority as number),
      }];
    })
    .sort((left, right) => left.order - right.order)
    .slice(0, MAX_ATTEMPTS);
}

async function logAttempt(admin: Admin, request: RouterRequest, candidate: Candidate, outcome: string, status: number | null, startedAt: number, bytes = 0) {
  try {
    await admin.from('ai_generation_events').insert({
      user_id: request.userId,
      feature: request.feature,
      model: `${candidate.providerId}/${candidate.modelId}`.slice(0, 120),
      provider_id: candidate.providerId,
      model_id: candidate.modelId,
      sensitivity: request.sensitivity,
      outcome,
      provider_status: status,
      duration_ms: Math.min(Date.now() - startedAt, 120_000),
      response_bytes: Math.min(bytes, 131_072),
    });
  } catch {
    // Telemetry must never change what the user receives.
  }
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

/**
 * Asks the best available model for JSON, falling through the registry on
 * failure. Returns null when every candidate is exhausted, which is the
 * caller's signal to use its own wording rather than to show an error.
 */
export async function routeJson(request: RouterRequest): Promise<RouterResult> {
  let admin: Admin;
  try {
    admin = createAdminClient();
  } catch {
    return null;
  }

  const available = await candidates(admin, request.sensitivity);
  for (const candidate of available) {
    const startedAt = Date.now();
    try {
      const response = await fetch(`${candidate.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env[candidate.apiKeyEnv]?.trim() ?? ''}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: candidate.modelId,
          messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }],
          temperature: request.temperature ?? 0.4,
          max_tokens: request.maxTokens,
          response_format: { type: 'json_object' },
          // Whatever else this model needs, from its registry row. Reasoning
          // effort lives there because providers spell it differently, Groq
          // rejects OpenRouter's spelling outright, and within Groq one model
          // needs it while another fails because of it.
          ...candidate.extra,
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(request.timeoutMs ?? 15_000),
      });

      if (!response.ok) {
        const outcome = response.status === 429 ? 'rate_limited'
          : response.status === 401 || response.status === 403 ? 'auth_failed'
            : response.status === 404 ? 'not_found' : 'failed';
        await logAttempt(admin, request, candidate, outcome, response.status, startedAt);
        await penalise(admin, candidate, outcome !== 'rate_limited');
        continue;
      }

      const raw = await response.text();
      const data = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> };
      const text = data.choices?.[0]?.message?.content ?? '';
      if (!text.trim()) {
        await logAttempt(admin, request, candidate, 'invalid_output', response.status, startedAt, raw.length);
        await penalise(admin, candidate, false);
        continue;
      }
      await logAttempt(admin, request, candidate, 'succeeded', response.status, startedAt, raw.length);
      await penalise(admin, candidate, false);
      return { text, providerId: candidate.providerId, modelId: candidate.modelId };
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      await logAttempt(admin, request, candidate, timedOut ? 'timeout' : 'failed', null, startedAt);
      await penalise(admin, candidate, !timedOut);
    }
  }
  return null;
}

/** Whether any model could serve this sensitivity right now, for settings copy. */
export async function routerAvailable(sensitivity: Sensitivity) {
  try {
    return (await candidates(createAdminClient(), sensitivity)).length > 0;
  } catch {
    return false;
  }
}
