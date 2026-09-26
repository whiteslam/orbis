-- Orbis AI router: per-provider request options.
--
-- Reasoning models spend output tokens thinking before they answer. Left alone,
-- a long system prompt plus a full reasoning pass uses the whole token budget
-- and the JSON never arrives, so the provider rejects its own completion and
-- every personal feature silently falls back to Orbis's own wording.
--
-- The fix is one field, and the providers disagree about its name: Groq wants a
-- top-level `reasoning_effort` and rejects anything else outright, OpenRouter
-- wants a `reasoning` object. That is per-provider request shape, which belongs
-- with the rest of what the registry knows about a provider rather than in a
-- map in the router.

alter table public.ai_providers
  add column if not exists request_extra jsonb not null default '{}'::jsonb;

comment on column public.ai_providers.request_extra is
  'Merged into the chat completion body for this provider. For options the provider needs but spells differently, such as reasoning effort.';

update public.ai_providers set request_extra = '{"reasoning_effort": "low"}'::jsonb
  where id in ('groq', 'gemini') and request_extra = '{}'::jsonb;

update public.ai_providers set request_extra = '{"reasoning": {"effort": "low"}}'::jsonb
  where id = 'openrouter' and request_extra = '{}'::jsonb;

-- Per-model overrides, because the field is not uniform within a provider either.
--
-- Checked against the live API on 2026-09-25 with the real brief prompt:
--   openai/gpt-oss-*   needs reasoning_effort low, or a full reasoning pass
--                      eats the token budget and the JSON never arrives.
--   qwen/qwen3.8-27b   is the opposite. reasoning_effort low makes it reason
--                      MORE, not less: it burned 1,488 completion tokens where
--                      the same prompt with no reasoning field at all answered
--                      in 37. With Groq's setting inherited it fails every
--                      request; with the field removed it is the cheapest model
--                      on the list.
--
-- null inherits the provider's options; an empty object deliberately overrides
-- them with none.
alter table public.ai_models
  add column if not exists request_extra jsonb;

comment on column public.ai_models.request_extra is
  'Overrides ai_providers.request_extra for this model. Null inherits; {} means send none of the provider''s options.';

update public.ai_models set request_extra = '{}'::jsonb
  where provider_id = 'groq' and model_id = 'qwen/qwen3.8-27b';
