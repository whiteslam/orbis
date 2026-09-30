-- Orbis: heads-ups, the things Orbis notices without being asked.
--
-- A scan (app/api/headsups/scan) writes rows with the service role; the owner
-- can read them and change only what they did about one (status, snooze).
-- Safe to run more than once.

create table if not exists public.headsups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (char_length(kind) between 1 and 60),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  urgency text not null check (urgency in ('normal', 'urgent')),
  evidence jsonb not null default '{}'::jsonb,
  title text not null check (char_length(title) between 1 and 80),
  body text not null check (char_length(body) between 1 and 300),
  action jsonb not null,
  action_label text not null check (char_length(action_label) between 1 and 40),
  worded_by text not null check (worded_by in ('ai', 'rules')),
  status text not null default 'new' check (status in ('new', 'seen', 'done', 'dismissed')),
  snoozed_until timestamptz,
  pushed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index if not exists headsups_user_status_idx on public.headsups (user_id, status, created_at desc);
create index if not exists headsups_push_idx on public.headsups (created_at) where urgency = 'urgent' and pushed_at is null;

drop trigger if exists headsups_set_updated_at on public.headsups;
create trigger headsups_set_updated_at
  before update on public.headsups
  for each row execute function public.set_updated_at();

alter table public.headsups enable row level security;
revoke all on public.headsups from public, anon, authenticated;
grant select on public.headsups to authenticated;
grant update (status, snoozed_until) on public.headsups to authenticated;
grant select, insert, update, delete on public.headsups to service_role;

drop policy if exists "Users read their own heads-ups" on public.headsups;
create policy "Users read their own heads-ups" on public.headsups
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users update their own heads-ups" on public.headsups;
create policy "Users update their own heads-ups" on public.headsups
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- One row per person: which kinds they turned off, and the day they were last
-- scanned. The row is created the first time Today asks for heads-ups, so the
-- scan only ever visits people who use Orbis.
create table if not exists public.headsup_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  disabled_kinds text[] not null default '{}',
  last_scan_date date,
  updated_at timestamptz not null default now()
);

drop trigger if exists headsup_preferences_set_updated_at on public.headsup_preferences;
create trigger headsup_preferences_set_updated_at
  before update on public.headsup_preferences
  for each row execute function public.set_updated_at();

alter table public.headsup_preferences enable row level security;
revoke all on public.headsup_preferences from public, anon, authenticated;
grant select on public.headsup_preferences to authenticated;
grant update (disabled_kinds) on public.headsup_preferences to authenticated;
grant select, insert, update, delete on public.headsup_preferences to service_role;

drop policy if exists "Users read their own heads-up settings" on public.headsup_preferences;
create policy "Users read their own heads-up settings" on public.headsup_preferences
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users update their own heads-up settings" on public.headsup_preferences;
create policy "Users update their own heads-up settings" on public.headsup_preferences
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Heads-up pushes are logged beside the daily slots. Several a day are allowed
-- (the cap lives in code), and headsups.pushed_at is what makes each one once-only.
alter table public.notification_log drop constraint if exists notification_log_slot_check;
alter table public.notification_log
  add constraint notification_log_slot_check
  check (slot in ('morning', 'lunch', 'evening', 'night', 'test', 'headsup'));

drop index if exists public.notification_log_one_per_slot_day;
create unique index if not exists notification_log_one_per_slot_day
  on public.notification_log (user_id, slot, local_date) where slot not in ('test', 'headsup');
