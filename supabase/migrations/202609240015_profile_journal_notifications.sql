-- Orbis: daily journal, notification settings, and Google Calendar scope tracking.
-- Notification tables follow docs/superpowers/specs/2026-09-24-daily-notifications-design.md
-- so the daily sender can use them unchanged.

-- Journal: one private entry per day.
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  entry_date date not null,
  mood smallint not null check (mood between 1 and 5),
  body text not null default '' check (char_length(body) <= 4000),
  tags text[] not null default '{}' check (cardinality(tags) <= 8),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint journal_entries_user_date_unique unique (user_id, entry_date)
);

create index if not exists journal_entries_user_date_idx on public.journal_entries (user_id, entry_date desc);

drop trigger if exists journal_entries_set_updated_at on public.journal_entries;
create trigger journal_entries_set_updated_at
  before update on public.journal_entries
  for each row execute function public.set_updated_at();

alter table public.journal_entries enable row level security;
drop policy if exists "Users manage their own journal" on public.journal_entries;
create policy "Users manage their own journal" on public.journal_entries
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.journal_entries to authenticated;

-- Notification preferences (one row per user).
create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  timezone text not null default 'Asia/Kolkata' check (char_length(timezone) between 1 and 64),
  morning_time time not null default '06:30',
  lunch_time time not null default '14:00',
  evening_time time not null default '19:00',
  night_time time not null default '22:00',
  morning_enabled boolean not null default true,
  lunch_enabled boolean not null default true,
  evening_enabled boolean not null default true,
  night_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

drop trigger if exists notification_preferences_set_updated_at on public.notification_preferences;
create trigger notification_preferences_set_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

alter table public.notification_preferences enable row level security;
drop policy if exists "Users manage their own notification preferences" on public.notification_preferences;
create policy "Users manage their own notification preferences" on public.notification_preferences
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.notification_preferences to authenticated;
grant select, insert, update, delete on public.notification_preferences to service_role;

-- Web Push subscriptions, one per device (at most 10 per user, enforced in the app).
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists "Users manage their own push subscriptions" on public.push_subscriptions;
create policy "Users manage their own push subscriptions" on public.push_subscriptions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;

-- Which Google scopes the user granted (Gmail, and now Calendar).
alter table public.gmail_connections
  add column if not exists granted_scopes text[] not null default '{}';
