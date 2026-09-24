# AI Router Core Design (free-only, multi-provider)

## Context and goal

Orbis currently sends every AI request to one OpenRouter model (`OPENROUTER_MODEL`, set to `google/gemini-3.8-flash`, a **paid** model). Callers:

- Portfolio suggestions (`app/invest/ai-actions.ts`)
- The health document planner (`lib/health-docs/planner.ts`, two calls)
- `app/health/library-actions.ts` and `lib/providers/status.ts`, which read `openRouterModel()`

**Goal:** Orbis uses **only free AI**. It spreads work across a pool of free providers and falls back automatically when one is rate-limited or failing. It never sends personal data to a model that may train on it.

This is sub-project **#1 of 5** of the AI orchestration plan. Later sub-projects each get their own spec:

- #2 AI Management screen
- #3 free-model discovery
- #4 multi-model "AI Team"
- #5 chunked parallel work

## Decisions

- **Free only, enforced in code.** A paid model is never called, even as a last resort.
- **Providers:** OpenRouter (free models only), Google Gemini (AI Studio), Groq and Mistral. Any other OpenAI-compatible provider can be added later as data, without code.
- **Privacy:** every provider and model carries a `may_train` flag. Requests marked `personal` only use models where `may_train` is false. If none is available, Orbis says so instead of sending.
- **The registry lives in Supabase.** API keys stay in environment variables, and the database stores only the variable name.

## Data model (migration `202609240018_ai_registry.sql`)

All tables have RLS enabled. Access is revoked from `anon` and `authenticated`, and only the service role can read or write.

### `ai_providers`

| column | type | notes |
|---|---|---|
| `id` | text PK | `openrouter`, `gemini`, `groq`, `mistral` |
| `name` | text | display name |
| `base_url` | text | OpenAI-compatible base, e.g. `https://api.groq.com/openai/v1` |
| `api_key_env` | text | e.g. `GROQ_API_KEY`; must match `^[A-Z][A-Z0-9_]{2,60}$` |
| `enabled` | bool, default true | |
| `priority` | smallint, default 100 | lower is tried first |
| `may_train` | bool | provider default |
| `cooldown_until` | timestamptz null | set on auth failures |
| `created_at`, `updated_at` | timestamptz | |

Seed values:

| Provider | Base URL | `may_train` default |
|---|---|---|
| OpenRouter | `https://openrouter.ai/api/v1` | true |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | true (free tier may be used to improve Google products) |
| Groq | `https://api.groq.com/openai/v1` | false |
| Mistral | `https://api.mistral.ai/v1` | true (Experiment tier) |

The user can change any of these defaults later.

### `ai_models`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `provider_id` | text FK → `ai_providers` | |
| `model_id` | text | the provider's model name; unique together with `provider_id` |
| `label` | text | |
| `context_window` | integer | tokens |
| `supports_json` | bool | JSON mode (`response_format: json_object`) |
| `is_free` | bool | **must be true to be used** |
| `may_train` | bool null | null means use the provider's value |
| `enabled` | bool, default true | |
| `priority` | smallint, default 100 | |
| `daily_limit` | integer null | optional per-day request cap |
| `cooldown_until` | timestamptz null | |
| `consecutive_failures` | smallint, default 0 | |
| `last_seen` | timestamptz null | used by discovery (#3) |

**Seed models:** exact free model IDs for each provider are checked against the provider's live `GET /models` during implementation and are not guessed. Seed at least:

- 2 OpenRouter `:free` models
- 1 Gemini Flash model
- 2 Groq models
- 1 Mistral model

### `ai_generation_events` (extended)

Add these columns:

- `provider_id text`
- `model_id text`
- `attempt smallint`
- `sensitivity text check in ('personal','general')`

The `outcome` check becomes `succeeded | rate_limited | timeout | failed | invalid_output | auth_failed | not_found`. The `feature` check is widened to a validated text value (`^[a-z_]{3,40}$`), so new features don't need a migration. Existing rows remain valid.

Daily usage per model, recent success rate and average latency are all calculated from this table.

## Routing

### Entry point

```ts
runAi({
  feature: 'portfolio_advice' | 'health_plan' | …,
  sensitivity: 'personal' | 'general',
  system: string,
  user: string,
  maxTokens: number,
  json: boolean,
  userId: string,
}): Promise<{ text: string; providerId: string; modelId: string }>
```

When nothing succeeds, `runAi` throws `AiUnavailableError`, whose message is safe to show to the user.

### Candidate selection (`lib/ai/select.ts`, pure)

A model is a candidate only if **all** of these hold:

1. The provider is enabled, not in cooldown, and `process.env[api_key_env]` is set.
2. The model is enabled, not in cooldown, and `is_free = true`.
3. **Free guard:** for `openrouter`, `model_id` ends with `:free` or equals `openrouter/free`. `openrouter/auto` and every other OpenRouter ID are rejected even if they are marked free.
4. For a `personal` request, the effective `may_train` (the model's value, else the provider's) is `false`.
5. If `json` is requested, `supports_json` is true.
6. Estimated tokens (`(system.length + user.length) / 4 + maxTokens`) are at most `context_window`.
7. If `daily_limit` is set, today's attempts on the model are below it.

Candidates are ordered by:

1. model priority, then provider priority
2. success rate over the last 24 hours (Laplace-smoothed)
3. median latency

### Fallback loop (`lib/ai/run.ts`)

- At most **3 attempts**, each on a different candidate. Each attempt has a **20 s** timeout, and the whole call has a **45 s** budget. No new attempt starts if less than 8 s of the budget remains.
- Each attempt is logged to `ai_generation_events`.

| Result | Action |
|---|---|
| 2xx and valid output (valid JSON when `json` is requested) | return it; reset `consecutive_failures` |
| 429 | model `cooldown_until = now + (Retry-After or 60 s × 2^min(failures,5))`; next candidate |
| 401 / 403 | provider `cooldown_until = now + 1 h`; next candidate on another provider |
| 404 | model `cooldown_until = now + 24 h`; next candidate |
| 5xx, network error, timeout | `consecutive_failures + 1`; after 3 in a row, 10 min cooldown; next candidate |
| 2xx with empty or invalid output | outcome `invalid_output`; next candidate |

When the loop runs out of candidates, the message depends on the reason:

- No personal-safe candidate: "No free AI model that keeps your data private is available right now. Try again in a few minutes."
- Otherwise: "Orbis's free AI models are busy right now. Try again in a few minutes."

### Adapter (`lib/ai/adapter.ts`)

- It makes one OpenAI-compatible `POST {base_url}/chat/completions` request with `model`, `messages`, `temperature: 0.2`, `max_tokens` and `response_format: { type: 'json_object' }` when `json` is requested.
- It reuses the current safety limits: 128 KiB response cap, `cache: 'no-store'`, and the abort signal.
- OpenRouter also gets the existing `http-referer` and `x-title` headers.
- It returns a tagged result: `ok | rate_limited(retryAfterSec) | auth_failed | not_found | server_error | timeout | invalid_output`.

## Changes to existing code

- `lib/ai/openrouter.ts` is replaced by the adapter. `OPENROUTER_MODEL` is no longer read and is removed from `.env.example`.
- `app/invest/ai-actions.ts` and `lib/health-docs/planner.ts` (2 calls) switch to `runAi` with `sensitivity: 'personal'`. Their existing error mapping becomes an `AiUnavailableError` message.
- `app/health/library-actions.ts`: model logging uses the returned `providerId/modelId`.
- `lib/providers/status.ts`: the AI integration shows the pool status, e.g. "3 of 4 providers ready · 1 private-data model", and never shows keys.
- The notifications design (`2026-09-24-daily-notifications-design.md`) uses `runAi` with `sensitivity: 'personal'`.

## Testing

Unit tests use `node --test --experimental-strip-types`:

- `select.test.ts`:
  - the free guard (rejects `openrouter/auto`, non-`:free` OpenRouter models, and `is_free = false`)
  - personal privacy filtering, with model-over-provider precedence
  - cooldowns, missing keys, JSON support, context fit, daily limit
  - ordering
- `adapter.test.ts`: status classification for 200, 429 (with and without `Retry-After`), 401, 403, 404, 500, invalid JSON, empty content and timeout.
- `run.test.ts`, with the registry and `fetch` injected:
  - a 429 on the first model means the second model answers
  - a personal request never reaches a `may_train` model
  - an attempt budget of 3
  - the correct friendly message when everything fails

Verification also covers a type-check and production build, and a live smoke test (one tiny JSON prompt) against every provider whose key is set.

## Setup (user)

1. Create free API keys at aistudio.google.com, console.groq.com and console.mistral.ai. The existing OpenRouter key is reused.
2. Add `GEMINI_API_KEY`, `GROQ_API_KEY` and `MISTRAL_API_KEY` to `.env.local` and to Vercel.
3. Apply migration `202609240018_ai_registry.sql`.

## Out of scope

- AI Management UI (#2)
- Automatic free-model discovery (#3)
- Multi-model roles and synthesis (#4)
- Chunked parallel inference (#5)
- Paid models and cost modes other than free-only

Until #2 exists, the registry is edited through SQL.
