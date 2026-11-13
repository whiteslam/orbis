-- Orbis: account plans. A plan sets the daily AI allowance per feature
-- (lib/ai/limits.ts). Anyone without an account_plans row is on 'free', and a
-- feature a plan does not name keeps the allowance it always had, so an empty
-- 'free' plan changes nothing.
--
-- Plans are assigned from the SQL editor or the service role, never from the
-- app. To put yourself on the owner plan, run (with your own address):
--
--   insert into public.account_plans (user_id, plan_id)
--   select id, 'owner' from auth.users where email = '<owner email>'
--   on conflict (user_id) do update set plan_id = excluded.plan_id;

create table if not exists public.plans (
  id text primary key,
  name text not null,
  limits jsonb not null default '{}'::jsonb
);

create table if not exists public.account_plans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan_id text not null default 'free' references public.plans (id),
  updated_at timestamptz not null default now()
);

-- 'owner' is every feature at ten times its default allowance, but never above
-- what the claim functions accept (50 for Ask, 1000 for the rest).
insert into public.plans (id, name, limits) values
  ('free', 'Free', '{}'::jsonb),
  ('owner', 'Owner', '{"ask_orbis":50,"home_brief":80,"portfolio_news":40,"workbook_advice":50,"health_plan":100,"portfolio_advice":50,"career_profile":300,"career_spec":400,"career_requirements":1000,"career_tailor":800,"career_alerts":1000,"career_mail":1000,"career_offer":300,"career_prep":400,"career_followup":1000}'::jsonb)
on conflict (id) do nothing;

alter table public.plans enable row level security;
drop policy if exists "Signed-in people read plans" on public.plans;
create policy "Signed-in people read plans" on public.plans
  for select to authenticated
  using (true);

alter table public.account_plans enable row level security;
drop policy if exists "Users read their own plan" on public.account_plans;
create policy "Users read their own plan" on public.account_plans
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Read-only for the person; writes come from the service role / SQL.
revoke all on public.plans from public, anon, authenticated;
revoke all on public.account_plans from public, anon, authenticated;
grant select on public.plans to authenticated;
grant select on public.account_plans to authenticated;
grant select, insert, update, delete on public.plans to service_role;
grant select, insert, update, delete on public.account_plans to service_role;
