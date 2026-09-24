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
