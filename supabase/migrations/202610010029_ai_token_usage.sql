-- Orbis AI router: tokens per attempt.
--
-- ai_generation_events recorded how many bytes a reply was, not what it cost,
-- so there was no way to say what Orbis spends on AI or what a paid model
-- would cost. Providers report token counts with every reply; the router now
-- keeps them. Null means the provider did not report usage, never a guess.
--
-- The router still writes rows without these columns until this is applied.
-- Safe to run more than once.

alter table public.ai_generation_events
  add column if not exists input_tokens integer check (input_tokens is null or input_tokens between 0 and 10000000),
  add column if not exists output_tokens integer check (output_tokens is null or output_tokens between 0 and 10000000);
