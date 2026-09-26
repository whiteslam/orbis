-- Orbis: routines, and what actually happened to them.
--
-- The Home brief could say what was true but not what was planned: a health
-- plan carries a focus and a duration, never a time, so "your 7 PM workout" had
-- nowhere to come from. These two tables are the difference between a brief
-- that describes your day and one that knows it.
--
--   routines        what you intend to do, and when
--   routine_events  what you did about it, one row per routine per day
--
-- Times are stored as a local wall clock, not a timestamp: 7 PM means 7 PM
-- wherever the user is, and must not shift with travel or daylight saving.

create table if not exists public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 60),
  -- What kind of thing this is, so the brief can word it and group it sensibly.
  kind text not null default 'other'
    check (kind in ('workout', 'meal', 'hydration', 'work', 'wind_down', 'other')),
  at_time time not null,
  -- Days of the week this runs, 0 = Sunday. Empty means never.
  days smallint[] not null default '{0,1,2,3,4,5,6}'
    check (array_length(days, 1) between 1 and 7 and days <@ '{0,1,2,3,4,5,6}'::smallint[]),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists routines_user_time_idx
  on public.routines (user_id, at_time)
  where active;

alter table public.routines enable row level security;
revoke all on public.routines from public, anon;
grant select, insert, update, delete on public.routines to authenticated;

drop policy if exists "Users manage their own routines" on public.routines;
create policy "Users manage their own routines" on public.routines
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- One answer per routine per day. Answering again replaces the answer rather
-- than appending, so a day cannot hold "done" and "skipped" for one routine.
create table if not exists public.routine_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Kept when the routine is deleted: the history of what you did is yours even
  -- once the plan behind it is gone.
  routine_id uuid references public.routines (id) on delete set null,
  -- Denormalised so a deleted routine's history still reads.
  title text not null check (char_length(title) between 1 and 60),
  local_date date not null,
  status text not null check (status in ('done', 'skipped', 'other')),
  -- What you did instead, for 'other'. "Walked for 30 minutes."
  note text check (note is null or char_length(note) between 1 and 200),
  created_at timestamptz not null default now()
);

-- One answer per routine per day, and an index Postgres will accept as an
-- ON CONFLICT target.
--
-- This was partial (`where routine_id is not null`), which reads correctly but
-- cannot be inferred: an upsert naming these three columns fails at plan time
-- with 42P10, "no unique or exclusion constraint matching the ON CONFLICT
-- specification", so every answer the user tapped errored before it saved.
--
-- A plain unique index is both a valid target and still correct, because
-- Postgres treats nulls as distinct by default: rows orphaned by a deleted
-- routine keep a null routine_id and never collide with one another.
drop index if exists public.routine_events_one_per_day_idx;
create unique index if not exists routine_events_one_per_day_idx
  on public.routine_events (user_id, routine_id, local_date);

create index if not exists routine_events_user_date_idx
  on public.routine_events (user_id, local_date desc);

alter table public.routine_events enable row level security;
revoke all on public.routine_events from public, anon;
grant select, insert, update, delete on public.routine_events to authenticated;

drop policy if exists "Users manage their own routine events" on public.routine_events;
create policy "Users manage their own routine events" on public.routine_events
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
