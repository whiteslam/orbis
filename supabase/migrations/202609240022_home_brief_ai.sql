-- Orbis: the AI Home brief.
--
-- The brief on Home was rule-based template copy. This lets a model write it
-- from the same numbers instead. Two things are needed for that:
--
-- 1. A consent record. Home is the landing screen, so a brief that generated
--    itself would send spending, goals and step counts to the model provider
--    without the user ever asking — which is the one thing Orbis promises it
--    does not do. The brief is off until this row says otherwise.
-- 2. Room in ai_results for the generated brief, cached per day and per
--    snapshot so it is regenerated when the underlying data moves, not on a
--    timer. The snapshot fingerprint lives in the existing context column.

create table if not exists public.ai_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Off by default: an AI brief is opt-in, never a default that has to be found and turned off.
  home_brief_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.ai_preferences enable row level security;
revoke all on public.ai_preferences from public, anon;
grant select, insert, update, delete on public.ai_preferences to authenticated;

drop policy if exists "Users manage their own AI preferences" on public.ai_preferences;
create policy "Users manage their own AI preferences" on public.ai_preferences
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ai_results.feature is a closed list; the brief joins it.
alter table public.ai_results drop constraint if exists ai_results_feature_check;
alter table public.ai_results add constraint ai_results_feature_check
  check (feature in ('workbook_advice', 'portfolio_advice', 'home_brief'));
