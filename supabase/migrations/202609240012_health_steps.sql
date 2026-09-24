-- Daily step totals imported from Apple Health exports. The export itself is parsed in the browser;
-- only one aggregated row per day reaches the database.

create table if not exists public.health_import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('apple_health_export')),
  file_name text not null check (char_length(file_name) between 1 and 200),
  record_count integer not null check (record_count >= 0),
  day_count integer not null check (day_count >= 0),
  first_date date,
  last_date date,
  created_at timestamptz not null default now()
);

create index if not exists health_import_batches_user_created_idx
  on public.health_import_batches (user_id, created_at desc);
alter table public.health_import_batches enable row level security;
create policy "Users manage their own health imports" on public.health_import_batches
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.health_import_batches to authenticated;

create table if not exists public.health_daily_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  steps integer not null check (steps between 0 and 200000),
  source text not null check (source in ('apple_health_export')),
  import_batch_id uuid references public.health_import_batches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date, source)
);

create index if not exists health_daily_steps_user_date_idx
  on public.health_daily_steps (user_id, date desc);
alter table public.health_daily_steps enable row level security;
create policy "Users manage their own daily steps" on public.health_daily_steps
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.health_daily_steps to authenticated;
