-- Orbis: every migration, in order, made safe to re-run.
--
-- NOT a migration. A convenience bundle for the Supabase SQL editor, generated
-- from supabase/migrations/. Use it when you do not know how far behind the
-- database is: applying it on any state brings it fully up to date and does
-- nothing for what is already there.
--
-- The migration files are idempotent apart from two things Postgres has no
-- "if not exists" for: create policy and create trigger. This bundle injects a
-- matching drop before each of those, which is the only difference from the
-- files themselves.
--
-- Paste the whole thing at once. It runs as one transaction, so it either
-- brings you fully up to date or changes nothing.



-- ══════════════════════════════════════════════════════════════
-- 202609240001_finance_gmail.sql
-- ══════════════════════════════════════════════════════════════

-- Orbis Phase 2: owner-scoped finance data and server-only Gmail connection data.

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  direction text not null check (direction in ('expense', 'income')),
  merchant text,
  category text,
  occurred_at timestamptz not null,
  source text not null check (source in ('gmail', 'manual')),
  source_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_gmail_source_message_check
    check ((source = 'gmail' and source_message_id is not null) or source = 'manual')
);

create index if not exists transactions_user_occurred_at_idx
  on public.transactions (user_id, occurred_at desc);

create unique index if not exists transactions_gmail_source_message_uidx
  on public.transactions (user_id, source_message_id)
  where source = 'gmail' and source_message_id is not null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

drop trigger if exists transactions_set_updated_at on public.transactions;
create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

alter table public.transactions enable row level security;

grant select, insert, update, delete on public.transactions to authenticated;

drop policy if exists transactions_select_own on public.transactions;
create policy transactions_select_own on public.transactions
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists transactions_insert_own on public.transactions;
create policy transactions_insert_own on public.transactions
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists transactions_update_own on public.transactions;
create policy transactions_update_own on public.transactions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists transactions_delete_own on public.transactions;
create policy transactions_delete_own on public.transactions
  for delete to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.gmail_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  google_email text not null,
  google_user_id text not null,
  refresh_token_encrypted text not null,
  status text not null default 'connected'
    check (status in ('connected', 'reconnect_required')),
  last_sync_at timestamptz,
  incremental_sync_after text,
  incremental_sync_page_token text,
  initial_sync_page_token text,
  initial_sync_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gmail_connections_id_user_id_unique unique (id, user_id)
);

create table if not exists public.gmail_sync_messages (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  gmail_message_id text not null,
  gmail_thread_id text not null,
  received_at timestamptz not null,
  sync_state text not null default 'pending'
    check (sync_state in ('pending', 'processed', 'ignored')),
  created_at timestamptz not null default now(),
  constraint gmail_sync_messages_connection_owner_fk
    foreign key (connection_id, user_id)
    references public.gmail_connections (id, user_id)
    on delete cascade,
  constraint gmail_sync_messages_connection_message_unique
    unique (connection_id, gmail_message_id)
);

drop trigger if exists gmail_connections_set_updated_at on public.gmail_connections;
create trigger gmail_connections_set_updated_at
  before update on public.gmail_connections
  for each row execute function public.set_updated_at();

create index if not exists gmail_sync_messages_connection_state_received_idx
  on public.gmail_sync_messages (connection_id, sync_state, received_at desc);

create index if not exists gmail_sync_messages_user_id_idx
  on public.gmail_sync_messages (user_id);

alter table public.gmail_connections enable row level security;
alter table public.gmail_sync_messages enable row level security;

-- OAuth credentials and candidate metadata are only accessed from authenticated
-- server handlers through the service role, after deriving the owner from auth.
revoke all on public.gmail_connections, public.gmail_sync_messages
  from public, anon, authenticated;
grant select, insert, update, delete on public.gmail_connections, public.gmail_sync_messages
  to service_role;



-- ══════════════════════════════════════════════════════════════
-- 202609240002_workbook_ai_usage.sql
-- ══════════════════════════════════════════════════════════════

create table if not exists public.workbook_ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  usage_date date not null,
  requests_used integer not null default 0 check (requests_used >= 0 and requests_used <= 20),
  primary key (user_id, usage_date)
);

alter table public.workbook_ai_usage enable row level security;
revoke all on public.workbook_ai_usage from public, anon, authenticated;
grant select, insert, update, delete on public.workbook_ai_usage to service_role;

create or replace function public.consume_workbook_ai_request(p_user_id uuid, p_daily_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requests_used integer;
begin
  if p_daily_limit < 1 or p_daily_limit > 20 then
    return false;
  end if;

  insert into public.workbook_ai_usage (user_id, usage_date, requests_used)
  values (p_user_id, (pg_catalog.now() at time zone 'UTC')::date, 1)
  on conflict (user_id, usage_date)
  do update set requests_used = public.workbook_ai_usage.requests_used + 1
    where public.workbook_ai_usage.requests_used < p_daily_limit
  returning requests_used into v_requests_used;

  return v_requests_used is not null;
end;
$$;

revoke all on function public.consume_workbook_ai_request(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_workbook_ai_request(uuid, integer) to service_role;



-- ══════════════════════════════════════════════════════════════
-- 202609240003_transaction_review.sql
-- ══════════════════════════════════════════════════════════════

alter table public.gmail_sync_messages
  add column if not exists parse_status text not null default 'unparsed'
    check (parse_status in ('unparsed', 'needs_review', 'unrecognized', 'processed', 'ignored')),
  add column if not exists parsed_amount numeric(14, 2)
    check (parsed_amount is null or parsed_amount > 0),
  add column if not exists parsed_currency text
    check (parsed_currency is null or parsed_currency ~ '^[A-Z]{3}$'),
  add column if not exists parsed_direction text
    check (parsed_direction is null or parsed_direction in ('expense', 'income')),
  add column if not exists parsed_merchant text,
  add column if not exists parse_reason text;

create index if not exists gmail_sync_messages_review_queue_idx
  on public.gmail_sync_messages (user_id, connection_id, parse_status, received_at desc)
  where sync_state = 'pending';

grant select, insert, update, delete on public.transactions to service_role;



-- ══════════════════════════════════════════════════════════════
-- 202609240004_goals_habits.sql
-- ══════════════════════════════════════════════════════════════

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
drop policy if exists "Users manage their goals" on public.goals;
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
drop policy if exists "Users manage their habits" on public.habits;
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
drop policy if exists "Users manage their own habit checkins" on public.habit_checkins;
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



-- ══════════════════════════════════════════════════════════════
-- 202609240005_orbis_memory.sql
-- ══════════════════════════════════════════════════════════════

create table if not exists public.user_context_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  note text not null check (char_length(note) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_context_notes_user_updated_idx
  on public.user_context_notes (user_id, updated_at desc);
alter table public.user_context_notes enable row level security;
drop policy if exists "Users manage their own context notes" on public.user_context_notes;
create policy "Users manage their own context notes" on public.user_context_notes
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.user_context_notes to authenticated;



-- ══════════════════════════════════════════════════════════════
-- 202609240006_investment_holdings.sql
-- ══════════════════════════════════════════════════════════════

create table if not exists public.investment_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  asset_type text not null check (asset_type in ('stock', 'fund', 'etf', 'crypto', 'cash', 'other')),
  quantity numeric(20, 6) not null check (quantity > 0),
  value_per_unit numeric(20, 4) not null check (value_per_unit >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  value_as_of date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists investment_holdings_user_updated_idx
  on public.investment_holdings (user_id, updated_at desc);
alter table public.investment_holdings enable row level security;
drop policy if exists "Users manage their own investment holdings" on public.investment_holdings;
create policy "Users manage their own investment holdings" on public.investment_holdings
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.investment_holdings to authenticated;



-- ══════════════════════════════════════════════════════════════
-- 202609240007_ai_generation_events.sql
-- ══════════════════════════════════════════════════════════════

create table if not exists public.ai_generation_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  feature text not null check (feature in ('workbook_advice')),
  model text not null check (char_length(model) between 1 and 120),
  outcome text not null check (outcome in ('succeeded', 'failed')),
  provider_status smallint check (provider_status between 100 and 599),
  duration_ms integer not null check (duration_ms between 0 and 120000),
  response_bytes integer not null default 0 check (response_bytes between 0 and 131072),
  created_at timestamptz not null default now()
);

create index if not exists ai_generation_events_user_created_idx
  on public.ai_generation_events (user_id, created_at desc);

alter table public.ai_generation_events enable row level security;
revoke all on public.ai_generation_events from public, anon, authenticated;
grant insert on public.ai_generation_events to service_role;



-- ══════════════════════════════════════════════════════════════
-- 202609240008_fitness_persona.sql
-- ══════════════════════════════════════════════════════════════

create table if not exists public.user_fitness_personas (
  user_id uuid primary key references auth.users (id) on delete cascade,
  persona text not null check (char_length(btrim(persona)) between 1 and 3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_fitness_personas enable row level security;

drop policy if exists "Users manage their own fitness persona" on public.user_fitness_personas;
create policy "Users manage their own fitness persona" on public.user_fitness_personas
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.user_fitness_personas to authenticated;



-- ══════════════════════════════════════════════════════════════
-- 202609240009_personal_profile.sql
-- ══════════════════════════════════════════════════════════════

create table if not exists public.user_personal_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  preferred_name text check (preferred_name is null or char_length(btrim(preferred_name)) between 1 and 80),
  role text check (role is null or char_length(btrim(role)) between 1 and 120),
  about_me text not null default '' check (char_length(btrim(about_me)) <= 3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_personal_profiles_not_empty check (
    nullif(btrim(preferred_name), '') is not null
    or nullif(btrim(role), '') is not null
    or char_length(btrim(about_me)) > 0
  )
);

alter table public.user_personal_profiles enable row level security;

drop policy if exists "Users manage their own personal profile" on public.user_personal_profiles;
create policy "Users manage their own personal profile" on public.user_personal_profiles
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.user_personal_profiles to authenticated;



-- ══════════════════════════════════════════════════════════════
-- 202609240010_manual_transactions.sql
-- ══════════════════════════════════════════════════════════════

-- Orbis: extra detail for manually entered transactions.

alter table public.transactions
  add column if not exists payment_method text
    check (payment_method is null or payment_method in ('upi', 'debit_card', 'credit_card', 'cash', 'net_banking', 'wallet', 'other')),
  add column if not exists note text
    check (note is null or char_length(note) <= 500);



-- ══════════════════════════════════════════════════════════════
-- 202609240011_portfolio_ai.sql
-- ══════════════════════════════════════════════════════════════

-- Orbis: log portfolio AI suggestions alongside workbook advice (metadata only).

alter table public.ai_generation_events
  drop constraint if exists ai_generation_events_feature_check;

alter table public.ai_generation_events
  add constraint ai_generation_events_feature_check
    check (feature in ('workbook_advice', 'portfolio_advice'));



-- ══════════════════════════════════════════════════════════════
-- 202609240012_health_steps.sql
-- ══════════════════════════════════════════════════════════════

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
drop policy if exists "Users manage their own health imports" on public.health_import_batches;
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
drop policy if exists "Users manage their own daily steps" on public.health_daily_steps;
create policy "Users manage their own daily steps" on public.health_daily_steps
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.health_daily_steps to authenticated;



-- ══════════════════════════════════════════════════════════════
-- 202609240013_api_cache.sql
-- ══════════════════════════════════════════════════════════════

-- Orbis: shared cache and health tracking for external data providers
-- (weather, currency, market prices, crypto), plus user location and
-- market symbols for manual holdings.

-- Provider responses, normalized. Server-only: no user data is stored here.
create table if not exists public.api_cache (
  key text primary key check (char_length(key) between 1 and 200),
  provider text not null check (char_length(provider) between 1 and 40),
  response jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists api_cache_provider_idx on public.api_cache (provider);

create table if not exists public.api_provider_status (
  provider text primary key check (char_length(provider) between 1 and 40),
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_kind text check (last_error_kind is null or last_error_kind in ('rate_limited', 'auth', 'unavailable', 'invalid_request', 'timeout', 'not_configured'))
);

create table if not exists public.api_daily_usage (
  provider text not null check (char_length(provider) between 1 and 40),
  usage_date date not null,
  calls integer not null default 0 check (calls >= 0),
  primary key (provider, usage_date)
);

alter table public.api_cache enable row level security;
alter table public.api_provider_status enable row level security;
alter table public.api_daily_usage enable row level security;

revoke all on public.api_cache, public.api_provider_status, public.api_daily_usage
  from public, anon, authenticated;
grant select, insert, update, delete on public.api_cache, public.api_provider_status, public.api_daily_usage
  to service_role;

-- Counts one outbound provider call against a daily budget (UTC day).
create or replace function public.consume_provider_call(p_provider text, p_daily_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_calls integer;
begin
  if p_daily_limit < 1 or p_daily_limit > 100000 then
    return false;
  end if;

  insert into public.api_daily_usage (provider, usage_date, calls)
  values (p_provider, (pg_catalog.now() at time zone 'UTC')::date, 1)
  on conflict (provider, usage_date)
  do update set calls = public.api_daily_usage.calls + 1
    where public.api_daily_usage.calls < p_daily_limit
  returning calls into v_calls;

  return v_calls is not null;
end;
$$;

revoke all on function public.consume_provider_call(text, integer) from public, anon, authenticated;
grant execute on function public.consume_provider_call(text, integer) to service_role;

-- Fallback location for weather when the browser location is not shared.
create table if not exists public.user_locations (
  user_id uuid primary key references auth.users (id) on delete cascade,
  city text not null check (char_length(btrim(city)) between 1 and 120),
  latitude numeric(8, 5) not null check (latitude between -90 and 90),
  longitude numeric(8, 5) not null check (longitude between -180 and 180),
  updated_at timestamptz not null default now()
);

alter table public.user_locations enable row level security;

drop policy if exists "Users manage their own location" on public.user_locations;
create policy "Users manage their own location" on public.user_locations
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.user_locations to authenticated;

-- Optional live-price link for manual holdings: what you own stays in the
-- table, the provider supplies what it is worth.
alter table public.investment_holdings
  add column if not exists market_symbol text
    check (market_symbol is null or market_symbol ~ '^[A-Za-z0-9._-]{1,40}$'),
  add column if not exists market_source text
    check (market_source is null or market_source in ('alpha_vantage', 'coingecko', 'amfi'));



-- ══════════════════════════════════════════════════════════════
-- 202609240014_groww_connections.sql
-- ══════════════════════════════════════════════════════════════

-- Orbis: per-user Groww connection. API key and secret are stored encrypted
-- (AES-256-GCM, server key) and only read by server code via the service role.

create table if not exists public.groww_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  api_key_encrypted text not null,
  api_secret_encrypted text not null,
  status text not null default 'connected' check (status in ('connected', 'reconnect_required')),
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists groww_connections_set_updated_at on public.groww_connections;
create trigger groww_connections_set_updated_at
  before update on public.groww_connections
  for each row execute function public.set_updated_at();

alter table public.groww_connections enable row level security;

-- Credentials never reach the browser: no grants for anon or authenticated.
revoke all on public.groww_connections from public, anon, authenticated;
grant select, insert, update, delete on public.groww_connections to service_role;



-- ══════════════════════════════════════════════════════════════
-- 202609240015_profile_journal_notifications.sql
-- ══════════════════════════════════════════════════════════════

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



-- ══════════════════════════════════════════════════════════════
-- 202609240016_app_pin.sql
-- ══════════════════════════════════════════════════════════════

-- Device unlock PIN. Only the salted scrypt hash is stored, and only the server (service role) can read it.
create table if not exists public.user_app_pins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  pin_hash text not null check (char_length(pin_hash) between 40 and 300),
  failed_attempts smallint not null default 0 check (failed_attempts between 0 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_app_pins enable row level security;
revoke all on public.user_app_pins from public, anon, authenticated;
grant select, insert, update, delete on public.user_app_pins to service_role;

-- Reserves one PIN attempt atomically before the hash is checked, so parallel guesses cannot exceed the limit.
-- Returns no row once 5 attempts are used; a correct PIN resets the counter.
create or replace function public.consume_app_pin_attempt(p_user_id uuid)
returns table (pin_hash text, failed_attempts smallint)
language sql
security definer
set search_path = public
as $$
  update public.user_app_pins as pins
     set failed_attempts = pins.failed_attempts + 1,
         updated_at = now()
   where pins.user_id = p_user_id
     and pins.failed_attempts < 5
  returning pins.pin_hash, pins.failed_attempts;
$$;

revoke execute on function public.consume_app_pin_attempt(uuid) from public, anon, authenticated;
grant execute on function public.consume_app_pin_attempt(uuid) to service_role;



-- ══════════════════════════════════════════════════════════════
-- 202609240017_health_documents_plans.sql
-- ══════════════════════════════════════════════════════════════

-- Orbis: saved health documents (original file + searchable text chunks with
-- embeddings for retrieval) and AI-generated health plans.

create extension if not exists vector with schema extensions;

-- Private bucket for original uploads. Only server code (service role) touches it.
insert into storage.buckets (id, name, public, file_size_limit)
values ('health-documents', 'health-documents', false, 52428800)
on conflict (id) do nothing;

create table if not exists public.health_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  file_name text not null check (char_length(file_name) between 1 and 120),
  kind text not null check (kind in ('pdf', 'xlsx')),
  size_bytes bigint not null check (size_bytes > 0),
  storage_path text,
  preview jsonb not null default '{}'::jsonb,
  chunk_count integer not null default 0 check (chunk_count >= 0),
  created_at timestamptz not null default now()
);

create index if not exists health_documents_user_created_idx on public.health_documents (user_id, created_at desc);

create table if not exists public.health_document_chunks (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.health_documents (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null check (char_length(content) between 1 and 4000),
  embedding extensions.vector(1536) not null,
  created_at timestamptz not null default now(),
  constraint health_document_chunks_doc_index_unique unique (document_id, chunk_index)
);

create index if not exists health_document_chunks_user_idx on public.health_document_chunks (user_id);
create index if not exists health_document_chunks_embedding_idx
  on public.health_document_chunks using hnsw (embedding extensions.vector_cosine_ops);

create table if not exists public.health_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  answers jsonb not null default '[]'::jsonb,
  plan jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists health_plans_user_created_idx on public.health_plans (user_id, created_at desc);

alter table public.health_documents enable row level security;
alter table public.health_document_chunks enable row level security;
alter table public.health_plans enable row level security;

-- Users can see and delete their own documents and plans; writes and chunk
-- access go through server code with the service role.
drop policy if exists "Users read their health documents" on public.health_documents;
create policy "Users read their health documents" on public.health_documents
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users read their health plans" on public.health_plans;
create policy "Users read their health plans" on public.health_plans
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users delete their health plans" on public.health_plans;
create policy "Users delete their health plans" on public.health_plans
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.health_documents, public.health_document_chunks, public.health_plans from anon;
grant select on public.health_documents to authenticated;
grant select, delete on public.health_plans to authenticated;
revoke all on public.health_document_chunks from authenticated;
grant select, insert, update, delete on public.health_documents, public.health_document_chunks, public.health_plans to service_role;

-- Nearest chunks for one user's documents (cosine similarity).
create or replace function public.match_health_chunks(p_user_id uuid, p_embedding extensions.vector(1536), p_count integer)
returns table (document_id uuid, chunk_index integer, content text, similarity double precision)
language sql
stable
security definer
set search_path = ''
as $$
  select c.document_id, c.chunk_index, c.content, 1 - (c.embedding operator(extensions.<=>) p_embedding) as similarity
  from public.health_document_chunks c
  where c.user_id = p_user_id
  order by c.embedding operator(extensions.<=>) p_embedding
  limit least(greatest(p_count, 1), 20);
$$;

revoke all on function public.match_health_chunks(uuid, extensions.vector, integer) from public, anon, authenticated;
grant execute on function public.match_health_chunks(uuid, extensions.vector, integer) to service_role;

-- Log the new AI features (metadata only), keeping every earlier feature.
alter table public.ai_generation_events drop constraint if exists ai_generation_events_feature_check;
alter table public.ai_generation_events
  add constraint ai_generation_events_feature_check
    check (feature in ('workbook_advice', 'portfolio_advice', 'daily_notification', 'health_plan_questions', 'health_plan'));



-- ══════════════════════════════════════════════════════════════
-- 202609240018_ai_registry.sql
-- ══════════════════════════════════════════════════════════════

-- Orbis AI router: registry of free AI providers and models, plus per-attempt logging.
-- API keys are never stored here: api_key_env names the server environment variable that holds each key.
-- Seed models were checked against each provider's live /models list and a JSON test call on 2026-09-24.

create table if not exists public.ai_providers (
  id text primary key check (id ~ '^[a-z][a-z0-9_-]{1,40}$'),
  name text not null check (char_length(name) between 1 and 80),
  base_url text not null check (base_url ~ '^https://[^\s]+$'),
  api_key_env text not null check (api_key_env ~ '^[A-Z][A-Z0-9_]{2,60}$'),
  enabled boolean not null default true,
  priority smallint not null default 100 check (priority between 0 and 1000),
  -- Provider default for whether prompts may be kept or used for training. Personal data only goes where this is false.
  may_train boolean not null,
  cooldown_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_models (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null references public.ai_providers (id) on delete cascade,
  model_id text not null check (char_length(model_id) between 1 and 160),
  label text not null check (char_length(label) between 1 and 120),
  context_window integer not null check (context_window between 1024 and 10000000),
  supports_json boolean not null default true,
  -- Must be true for the router to use the model. OpenRouter models must also be ':free' (enforced in code too).
  is_free boolean not null default false,
  may_train boolean,
  enabled boolean not null default true,
  priority smallint not null default 100 check (priority between 0 and 1000),
  daily_limit integer check (daily_limit is null or daily_limit > 0),
  cooldown_until timestamptz,
  consecutive_failures smallint not null default 0 check (consecutive_failures between 0 and 1000),
  last_seen timestamptz,
  notes text check (notes is null or char_length(notes) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, model_id),
  constraint ai_models_openrouter_free_only check (provider_id <> 'openrouter' or model_id like '%:free' or model_id = 'openrouter/free')
);

alter table public.ai_providers enable row level security;
alter table public.ai_models enable row level security;
revoke all on public.ai_providers, public.ai_models from public, anon, authenticated;
grant select, insert, update, delete on public.ai_providers, public.ai_models to service_role;

insert into public.ai_providers (id, name, base_url, api_key_env, priority, may_train) values
  ('groq', 'Groq', 'https://api.groq.com/openai/v1', 'GROQ_API_KEY', 10, false),
  ('gemini', 'Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', 'GEMINI_API_KEY', 20, true),
  ('mistral', 'Mistral', 'https://api.mistral.ai/v1', 'MISTRAL_API_KEY', 30, true),
  ('openrouter', 'OpenRouter (free models)', 'https://openrouter.ai/api/v1', 'OPENROUTER_API_KEY', 40, true)
on conflict (id) do nothing;

insert into public.ai_models (provider_id, model_id, label, context_window, supports_json, is_free, priority, enabled, notes) values
  ('groq', 'openai/gpt-oss-120b', 'GPT-OSS 120B (Groq)', 131072, true, true, 10, true, null),
  ('groq', 'openai/gpt-oss-20b', 'GPT-OSS 20B (Groq)', 131072, true, true, 20, true, null),
  ('groq', 'qwen/qwen3.8-27b', 'Qwen 3.8 27B (Groq)', 131072, true, true, 30, true, null),
  ('gemini', 'gemini-flash-latest', 'Gemini Flash', 1048576, true, true, 10, true, 'Returned 503 (high demand) in the seed test; kept, fallback covers it.'),
  ('gemini', 'gemini-flash-lite-latest', 'Gemini Flash-Lite', 1048576, true, true, 20, true, null),
  ('mistral', 'ministral-8b-latest', 'Ministral 8B', 262144, true, true, 10, true, null),
  ('mistral', 'mistral-small-latest', 'Mistral Small', 262144, true, true, 20, true, 'Rate-limited (429) on the free tier in the seed test.'),
  ('openrouter', 'nvidia/nemotron-3-super-120b-a12b:free', 'Nemotron 3 Super 120B (free)', 262144, true, true, 10, true, null),
  ('openrouter', 'google/gemma-4-31b-it:free', 'Gemma 4 31B (free)', 262144, true, true, 20, true, 'Rate-limited (429) upstream in the seed test.'),
  ('openrouter', 'openrouter/free', 'OpenRouter free router', 200000, true, true, 90, false, 'Disabled: routed a JSON request to a safety classifier in the seed test.')
on conflict (provider_id, model_id) do nothing;

-- Per-attempt logging for the router: which provider/model answered, how, and for which kind of data.
alter table public.ai_generation_events
  add column if not exists provider_id text check (provider_id is null or char_length(provider_id) <= 40),
  add column if not exists model_id text check (model_id is null or char_length(model_id) <= 160),
  add column if not exists attempt smallint check (attempt is null or attempt between 1 and 10),
  add column if not exists sensitivity text check (sensitivity is null or sensitivity in ('personal', 'general'));

alter table public.ai_generation_events drop constraint if exists ai_generation_events_outcome_check;
alter table public.ai_generation_events
  add constraint ai_generation_events_outcome_check
    check (outcome in ('succeeded', 'failed', 'rate_limited', 'timeout', 'invalid_output', 'auth_failed', 'not_found'));

-- New AI features no longer need a migration: any short snake_case feature name is accepted.
alter table public.ai_generation_events drop constraint if exists ai_generation_events_feature_check;
alter table public.ai_generation_events
  add constraint ai_generation_events_feature_check check (feature ~ '^[a-z][a-z_]{2,39}$');

create index if not exists ai_generation_events_model_created_idx
  on public.ai_generation_events (provider_id, model_id, created_at desc);

-- The router reads recent attempts to compute health, usage and latency.
grant select on public.ai_generation_events to service_role;



-- ══════════════════════════════════════════════════════════════
-- 202609240019_notification_log.sql
-- ══════════════════════════════════════════════════════════════

-- Orbis: sent notifications (inbox + send log). Inserting the row for (user, slot, local date) claims that send,
-- so overlapping or retried scheduler runs can never deliver the same slot twice.

create table if not exists public.notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  slot text not null check (slot in ('morning', 'lunch', 'evening', 'night', 'test')),
  local_date date not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  title text check (title is null or char_length(title) <= 80),
  body text check (body is null or char_length(body) <= 300),
  source text check (source is null or source in ('ai', 'rules')),
  devices_sent smallint not null default 0 check (devices_sent between 0 and 50),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists notification_log_one_per_slot_day
  on public.notification_log (user_id, slot, local_date) where slot <> 'test';
create index if not exists notification_log_user_created_idx on public.notification_log (user_id, created_at desc);

alter table public.notification_log enable row level security;

-- Users can read their notifications and mark them read; sending is server-only.
drop policy if exists "Users read their notifications" on public.notification_log;
create policy "Users read their notifications" on public.notification_log
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users mark their notifications read" on public.notification_log;
create policy "Users mark their notifications read" on public.notification_log
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.notification_log from anon;
grant select on public.notification_log to authenticated;
grant update (read_at) on public.notification_log to authenticated;
grant select, insert, update, delete on public.notification_log to service_role;



-- ══════════════════════════════════════════════════════════════
-- 202609240020_ai_results.sql
-- ══════════════════════════════════════════════════════════════

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



-- ══════════════════════════════════════════════════════════════
-- 202609240021_health_document_always.sql
-- ══════════════════════════════════════════════════════════════

-- Orbis: a "master" health document — one the plan builder reads every time,
-- instead of only when a search happens to surface it.
--
-- Retrieval is still used for everything else; this flag guarantees the file the
-- user considers their baseline (a full blood panel, a coach's programme) is in
-- context for every plan.

alter table public.health_documents
  add column if not exists always_include boolean not null default false;

create index if not exists health_documents_always_idx
  on public.health_documents (user_id) where always_include;



-- ══════════════════════════════════════════════════════════════
-- 202609240022_home_brief_ai.sql
-- ══════════════════════════════════════════════════════════════

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



-- ══════════════════════════════════════════════════════════════
-- 202609240023_routines.sql
-- ══════════════════════════════════════════════════════════════

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



-- ══════════════════════════════════════════════════════════════
-- 202609240024_ai_request_extra.sql
-- ══════════════════════════════════════════════════════════════

-- Orbis AI router: per-provider request options.
--
-- Reasoning models spend output tokens thinking before they answer. Left alone,
-- a long system prompt plus a full reasoning pass uses the whole token budget
-- and the JSON never arrives, so the provider rejects its own completion and
-- every personal feature silently falls back to Orbis's own wording.
--
-- The fix is one field, and the providers disagree about its name: Groq wants a
-- top-level `reasoning_effort` and rejects anything else outright, OpenRouter
-- wants a `reasoning` object. That is per-provider request shape, which belongs
-- with the rest of what the registry knows about a provider rather than in a
-- map in the router.

alter table public.ai_providers
  add column if not exists request_extra jsonb not null default '{}'::jsonb;

comment on column public.ai_providers.request_extra is
  'Merged into the chat completion body for this provider. For options the provider needs but spells differently, such as reasoning effort.';

update public.ai_providers set request_extra = '{"reasoning_effort": "low"}'::jsonb
  where id in ('groq', 'gemini') and request_extra = '{}'::jsonb;

update public.ai_providers set request_extra = '{"reasoning": {"effort": "low"}}'::jsonb
  where id = 'openrouter' and request_extra = '{}'::jsonb;

-- Per-model overrides, because the field is not uniform within a provider either.
--
-- Checked against the live API on 2026-09-25 with the real brief prompt:
--   openai/gpt-oss-*   needs reasoning_effort low, or a full reasoning pass
--                      eats the token budget and the JSON never arrives.
--   qwen/qwen3.8-27b   is the opposite. reasoning_effort low makes it reason
--                      MORE, not less: it burned 1,488 completion tokens where
--                      the same prompt with no reasoning field at all answered
--                      in 37. With Groq's setting inherited it fails every
--                      request; with the field removed it is the cheapest model
--                      on the list.
--
-- null inherits the provider's options; an empty object deliberately overrides
-- them with none.
alter table public.ai_models
  add column if not exists request_extra jsonb;

comment on column public.ai_models.request_extra is
  'Overrides ai_providers.request_extra for this model. Null inherits; {} means send none of the provider''s options.';

update public.ai_models set request_extra = '{}'::jsonb
  where provider_id = 'groq' and model_id = 'qwen/qwen3.8-27b';



-- ══════════════════════════════════════════════════════════════
-- 202609240025_zerodha_connections.sql
-- ══════════════════════════════════════════════════════════════

-- Orbis: per-user Zerodha (Kite Connect) session.
--
-- Unlike Groww, the key and secret are not enough to read holdings. Kite issues
-- an access token only through an interactive login, and that token dies at the
-- start of the next trading day: there is no refresh token and no server-side
-- renewal, by design. So what is stored here is a session with an expiry, and
-- the app's job is to say plainly when it has run out rather than show stale
-- numbers as though they were today's.
--
-- The API key and secret come from the server environment (ZERODHA_API_KEY and
-- ZERODHA_API_SECRET), because a Kite app is tied to one Zerodha client ID.

create table if not exists public.zerodha_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- AES-256-GCM with the server key, the same as every other stored credential.
  access_token_encrypted text not null,
  -- Whose Zerodha account this is, for the card to name it.
  kite_user_id text check (kite_user_id is null or char_length(kite_user_id) <= 40),
  expires_at timestamptz not null,
  status text not null default 'connected' check (status in ('connected', 'reconnect_required')),
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists zerodha_connections_set_updated_at on public.zerodha_connections;
create trigger zerodha_connections_set_updated_at
  before update on public.zerodha_connections
  for each row execute function public.set_updated_at();

alter table public.zerodha_connections enable row level security;

-- The session token never reaches the browser: no grants for anon or authenticated.
revoke all on public.zerodha_connections from public, anon, authenticated;
grant select, insert, update, delete on public.zerodha_connections to service_role;
