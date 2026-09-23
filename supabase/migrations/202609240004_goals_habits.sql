create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  current_value numeric(14, 2) not null default 0 check (current_value >= 0),
  target_value numeric(14, 2) not null check (target_value > 0),
  unit text not null default '' check (char_length(unit) <= 24),
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_value <= target_value)
);

create index if not exists goals_user_created_idx on public.goals (user_id, created_at desc);
alter table public.goals enable row level security;
create policy "Users manage their goals" on public.goals
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.goals to authenticated;

create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists habits_user_created_idx on public.habits (user_id, created_at desc)
  where archived_at is null;
alter table public.habits enable row level security;
create policy "Users manage their habits" on public.habits
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.habits to authenticated;

create table if not exists public.habit_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references public.habits(id) on delete cascade,
  checked_on date not null default (now() at time zone 'UTC')::date,
  created_at timestamptz not null default now(),
  unique (habit_id, checked_on)
);

create index if not exists habit_checkins_user_day_idx on public.habit_checkins (user_id, checked_on desc);
alter table public.habit_checkins enable row level security;
create policy "Users manage their own habit checkins" on public.habit_checkins
  for all to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.habits
      where habits.id = habit_checkins.habit_id
        and habits.user_id = (select auth.uid())
    )
  );
grant select, insert, update, delete on public.habit_checkins to authenticated;
