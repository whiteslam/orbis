-- Orbis AI router: Claude Haiku 4.5 through OpenRouter.
--
-- 202610010031_ai_paid_models.sql added Claude through Anthropic's own API,
-- which needs ANTHROPIC_API_KEY. This reaches the same model with the
-- OPENROUTER_API_KEY Orbis already has. Run 0031 first: this uses its price
-- columns.
--
-- Applying this turns paid AI on, within ORBIS_AI_MONTHLY_BUDGET_INR (₹300
-- unless set). Free models still go first; Haiku answers when they fail (or
-- first for Ask Orbis, plans and advice from ₹500). Every rupee is logged in
-- ai_generation_events.cost_usd and shown in Settings.
--
-- Personal data. OpenRouter is a router: the provider behind a request is
-- whichever it picks. This model's request_extra pins it to Anthropic, with no
-- fallback to another host, and tells OpenRouter to use only providers that do
-- not collect data (data_collection "deny"). Only with that setting is the row
-- may_train = false; lib/ai/policy.ts personalDataGuarded() refuses personal
-- data to any OpenRouter model whose request does not carry it, whatever this
-- row says. Checked live on 2026-10-01: the request was served by Anthropic.
-- Zero-data-retention mode (zdr) is not offered for this model on OpenRouter,
-- so it is not requested; Anthropic still does not train on API traffic by
-- default. Also make sure prompt logging is off in your OpenRouter account
-- (openrouter.ai/settings/privacy).
--
-- To keep personal data away from it:
--   update public.ai_models set may_train = true where provider_id = 'openrouter' and model_id = 'anthropic/claude-haiku-4.5';
-- To switch it off:
--   update public.ai_models set enabled = false where provider_id = 'openrouter' and model_id = 'anthropic/claude-haiku-4.5';
--
-- Price from OpenRouter's /models list on 2026-10-01: $1 input, $5 output per
-- million tokens, the same as Anthropic's list price.
--
-- Safe to run more than once.

-- OpenRouter was free models only. A priced, paid model is now allowed too;
-- an unpriced one still is not.
alter table public.ai_models drop constraint if exists ai_models_openrouter_free_only;
alter table public.ai_models add constraint ai_models_openrouter_free_only check (
  provider_id <> 'openrouter'
  or model_id like '%:free'
  or model_id = 'openrouter/free'
  or (is_free = false and input_usd_per_mtok is not null and output_usd_per_mtok is not null)
);

insert into public.ai_models (provider_id, model_id, label, context_window, supports_json, is_free, may_train, priority, enabled, input_usd_per_mtok, output_usd_per_mtok, request_extra, notes) values
  ('openrouter', 'anthropic/claude-haiku-4.5', 'Claude Haiku 4.5 (via OpenRouter)', 200000, true, false, false, 50, true, 1.0000, 5.0000,
   '{"provider": {"data_collection": "deny", "only": ["anthropic"], "allow_fallbacks": false}}'::jsonb,
   'Paid, budgeted. Pinned to Anthropic with data_collection deny; that is what makes may_train false.')
on conflict (provider_id, model_id) do nothing;
