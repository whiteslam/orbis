-- Orbis: what you expect to earn, so the app can tell salary from extra money.
--
-- Income was already recordable: a transaction with direction 'income' and a
-- category such as Salary or Freelance. Two things were missing.
--
-- First, nothing knew what a normal month looks like. Without an expected
-- salary the app cannot say "it has not landed yet", cannot separate a regular
-- wage from a one-off, and cannot measure what was kept rather than only what
-- was spent.
--
-- Second, the category on an income row was written and never read: the month
-- breakdown accumulated categories for expenses only, so "where did the extra
-- money come from" had an answer stored and no way to see it. That half is
-- fixed in code; this table is the other half.
--
-- One row per expected income stream. Most people have one. Someone with a
-- salary and a steady retainer has two.

create table if not exists public.income_plan (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 60),
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  -- Day of the month it usually arrives. 31 lands on the last day of shorter months.
  pay_day smallint not null default 1 check (pay_day between 1 and 31),
  -- Which income category counts as this stream, so arrivals can be matched.
  category text not null default 'Salary' check (char_length(category) between 1 and 40),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists income_plan_user_idx on public.income_plan (user_id) where active;

drop trigger if exists income_plan_set_updated_at on public.income_plan;
create trigger income_plan_set_updated_at
  before update on public.income_plan
  for each row execute function public.set_updated_at();

alter table public.income_plan enable row level security;
revoke all on public.income_plan from public, anon;
grant select, insert, update, delete on public.income_plan to authenticated;

drop policy if exists "Users manage their own income plan" on public.income_plan;
create policy "Users manage their own income plan" on public.income_plan
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
