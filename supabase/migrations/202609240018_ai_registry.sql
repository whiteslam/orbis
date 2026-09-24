-- Orbis AI router: registry of free AI providers and models, plus per-attempt logging.
-- API keys are never stored here: api_key_env names the server environment variable that holds each key.
-- Seed models were checked against each provider's live /models list and a JSON test call on 2026-09-24.

create table if not exists public.ai_providers (
  id text primary key check (id ~ '^[a-z][a-z0-9_-]{1,40}$'),
  name text not null check (char_length(name) between 1 and 80),
  base_url text not null check (base_url ~ '^https://[^\s]+$'),
  api_key_env text not null check (api_key_env ~ '^[A-Z][A-Z0-9_]{2,60}$'),
  enabled boolean not null default true,
  priority smallint not null default 100 check (priority between 0 and 1000),
  -- Provider default for whether prompts may be kept or used for training. Personal data only goes where this is false.
  may_train boolean not null,
  cooldown_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_models (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null references public.ai_providers (id) on delete cascade,
  model_id text not null check (char_length(model_id) between 1 and 160),
  label text not null check (char_length(label) between 1 and 120),
  context_window integer not null check (context_window between 1024 and 10000000),
  supports_json boolean not null default true,
  -- Must be true for the router to use the model. OpenRouter models must also be ':free' (enforced in code too).
  is_free boolean not null default false,
  may_train boolean,
  enabled boolean not null default true,
  priority smallint not null default 100 check (priority between 0 and 1000),
  daily_limit integer check (daily_limit is null or daily_limit > 0),
  cooldown_until timestamptz,
  consecutive_failures smallint not null default 0 check (consecutive_failures between 0 and 1000),
  last_seen timestamptz,
  notes text check (notes is null or char_length(notes) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, model_id),
  constraint ai_models_openrouter_free_only check (provider_id <> 'openrouter' or model_id like '%:free' or model_id = 'openrouter/free')
);

alter table public.ai_providers enable row level security;
alter table public.ai_models enable row level security;
revoke all on public.ai_providers, public.ai_models from public, anon, authenticated;
grant select, insert, update, delete on public.ai_providers, public.ai_models to service_role;

insert into public.ai_providers (id, name, base_url, api_key_env, priority, may_train) values
  ('groq', 'Groq', 'https://api.groq.com/openai/v1', 'GROQ_API_KEY', 10, false),
  ('gemini', 'Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', 'GEMINI_API_KEY', 20, true),
  ('mistral', 'Mistral', 'https://api.mistral.ai/v1', 'MISTRAL_API_KEY', 30, true),
  ('openrouter', 'OpenRouter (free models)', 'https://openrouter.ai/api/v1', 'OPENROUTER_API_KEY', 40, true)
on conflict (id) do nothing;

insert into public.ai_models (provider_id, model_id, label, context_window, supports_json, is_free, priority, enabled, notes) values
  ('groq', 'openai/gpt-oss-120b', 'GPT-OSS 120B (Groq)', 131072, true, true, 10, true, null),
  ('groq', 'openai/gpt-oss-20b', 'GPT-OSS 20B (Groq)', 131072, true, true, 20, true, null),
  ('groq', 'qwen/qwen3.8-27b', 'Qwen 3.8 27B (Groq)', 131072, true, true, 30, true, null),
  ('gemini', 'gemini-flash-latest', 'Gemini Flash', 1048576, true, true, 10, true, 'Returned 503 (high demand) in the seed test; kept, fallback covers it.'),
  ('gemini', 'gemini-flash-lite-latest', 'Gemini Flash-Lite', 1048576, true, true, 20, true, null),
  ('mistral', 'ministral-8b-latest', 'Ministral 8B', 262144, true, true, 10, true, null),
  ('mistral', 'mistral-small-latest', 'Mistral Small', 262144, true, true, 20, true, 'Rate-limited (429) on the free tier in the seed test.'),
  ('openrouter', 'nvidia/nemotron-3-super-120b-a12b:free', 'Nemotron 3 Super 120B (free)', 262144, true, true, 10, true, null),
  ('openrouter', 'google/gemma-4-31b-it:free', 'Gemma 4 31B (free)', 262144, true, true, 20, true, 'Rate-limited (429) upstream in the seed test.'),
  ('openrouter', 'openrouter/free', 'OpenRouter free router', 200000, true, true, 90, false, 'Disabled: routed a JSON request to a safety classifier in the seed test.')
on conflict (provider_id, model_id) do nothing;

-- Per-attempt logging for the router: which provider/model answered, how, and for which kind of data.
alter table public.ai_generation_events
  add column if not exists provider_id text check (provider_id is null or char_length(provider_id) <= 40),
  add column if not exists model_id text check (model_id is null or char_length(model_id) <= 160),
  add column if not exists attempt smallint check (attempt is null or attempt between 1 and 10),
  add column if not exists sensitivity text check (sensitivity is null or sensitivity in ('personal', 'general'));

alter table public.ai_generation_events drop constraint if exists ai_generation_events_outcome_check;
alter table public.ai_generation_events
  add constraint ai_generation_events_outcome_check
    check (outcome in ('succeeded', 'failed', 'rate_limited', 'timeout', 'invalid_output', 'auth_failed', 'not_found'));

-- New AI features no longer need a migration: any short snake_case feature name is accepted.
alter table public.ai_generation_events drop constraint if exists ai_generation_events_feature_check;
alter table public.ai_generation_events
  add constraint ai_generation_events_feature_check check (feature ~ '^[a-z][a-z_]{2,39}$');

create index if not exists ai_generation_events_model_created_idx
  on public.ai_generation_events (provider_id, model_id, created_at desc);

-- The router reads recent attempts to compute health, usage and latency.
grant select on public.ai_generation_events to service_role;
