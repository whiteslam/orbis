-- Orbis AI router: paid models, priced and budgeted.
--
-- Until now the router only ever used free models (is_free = true), and the
-- registry had no idea what a request cost. This adds:
--
-- 1. ai_providers.api_style: how to talk to a provider. Everything so far
--    speaks the OpenAI chat-completions shape; Anthropic has its own Messages
--    API. The router has one adapter per style (lib/ai/adapters).
-- 2. ai_models.input_usd_per_mtok / output_usd_per_mtok: list price per
--    million tokens. A model with is_free = false is only used when both are
--    set, so an unpriced paid model can never run up a bill nobody can see.
-- 3. ai_generation_events.cost_usd: what each attempt cost, from the tokens
--    the provider reported and the price at that moment.
-- 4. ai_spend_since(): this month's total, which the router compares with
--    ORBIS_AI_MONTHLY_BUDGET_INR before it lets a paid model run.
-- 5. Claude Haiku 4.5, seeded as the paid reliability layer. Anthropic's
--    commercial API terms say inputs and outputs are not used for training by
--    default, so the provider is may_train = false and may see personal data.
--    Check that against the terms you signed up under. To keep personal data
--    away from it:
--      update public.ai_providers set may_train = true where id = 'anthropic';
--    To switch it off entirely:
--      update public.ai_providers set enabled = false where id = 'anthropic';
--    It also stays unused while ANTHROPIC_API_KEY is unset.
--
-- Prices were taken from Anthropic's published list price for
-- claude-haiku-4-5 ($1 input / $5 output per million tokens). Update the row
-- if they change; nothing in code holds a price.
--
-- Safe to run more than once.

alter table public.ai_providers
  add column if not exists api_style text not null default 'openai'
    check (api_style in ('openai', 'anthropic'));

alter table public.ai_models
  add column if not exists input_usd_per_mtok numeric(10, 4) check (input_usd_per_mtok is null or input_usd_per_mtok >= 0),
  add column if not exists output_usd_per_mtok numeric(10, 4) check (output_usd_per_mtok is null or output_usd_per_mtok >= 0);

alter table public.ai_generation_events
  add column if not exists cost_usd numeric(12, 8) check (cost_usd is null or cost_usd >= 0);

create index if not exists ai_generation_events_created_idx
  on public.ai_generation_events (created_at desc);

-- The month's spend across everyone: the bill is the owner's, not per person.
create or replace function public.ai_spend_since(p_since timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(cost_usd), 0)
  from public.ai_generation_events
  where created_at >= p_since and cost_usd is not null;
$$;

revoke all on function public.ai_spend_since(timestamptz) from public, anon, authenticated;
grant execute on function public.ai_spend_since(timestamptz) to service_role;

insert into public.ai_providers (id, name, base_url, api_key_env, priority, may_train, api_style) values
  ('anthropic', 'Anthropic (Claude)', 'https://api.anthropic.com', 'ANTHROPIC_API_KEY', 50, false, 'anthropic')
on conflict (id) do nothing;

insert into public.ai_models (provider_id, model_id, label, context_window, supports_json, is_free, priority, enabled, input_usd_per_mtok, output_usd_per_mtok, notes) values
  ('anthropic', 'claude-haiku-4-5', 'Claude Haiku 4.5', 200000, true, false, 10, true, 1.0000, 5.0000,
   'Paid. Used within ORBIS_AI_MONTHLY_BUDGET_INR: as a fallback by default, first for quality features from ₹500.')
on conflict (provider_id, model_id) do nothing;
