-- Orbis: saved AI results, so generated advice survives a reload instead of
-- having to be generated again.
--
-- Only what is needed to render the result again is stored: the parsed advice
-- JSON and the labels it cites. Raw workbook rows, holdings and the prompts
-- themselves are still never written here.

create table if not exists public.ai_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  feature text not null check (feature in ('workbook_advice', 'portfolio_advice')),
  title text check (title is null or char_length(title) between 1 and 160),
  -- Display context for the saved result (e.g. the observations the advice cites).
  context jsonb not null default '{}'::jsonb,
  result jsonb not null,
  model text not null check (char_length(model) between 1 and 120),
  created_at timestamptz not null default now()
);

create index if not exists ai_results_user_feature_created_idx
  on public.ai_results (user_id, feature, created_at desc);

alter table public.ai_results enable row level security;
revoke all on public.ai_results from public, anon;
grant select, delete on public.ai_results to authenticated;

-- Users read and delete their own saved results; writes go through server code
-- with the service role, the same way generation itself does.
drop policy if exists "Users read their AI results" on public.ai_results;
create policy "Users read their AI results" on public.ai_results
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users delete their AI results" on public.ai_results;
create policy "Users delete their AI results" on public.ai_results
  for delete to authenticated using ((select auth.uid()) = user_id);
