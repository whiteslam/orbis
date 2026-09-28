-- Orbis: a daily allowance for "Ask Orbis", questions about your own data.
--
-- The same shape as workbook_ai_usage: one counter row per user per day,
-- claimed atomically by a service-role function before the question is sent,
-- so double-clicks and parallel tabs cannot exceed the limit.

create table if not exists public.ask_orbis_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  usage_date date not null,
  requests_used integer not null default 0 check (requests_used >= 0),
  primary key (user_id, usage_date)
);

alter table public.ask_orbis_usage enable row level security;
revoke all on public.ask_orbis_usage from public, anon, authenticated;
grant select, insert, update, delete on public.ask_orbis_usage to service_role;

create or replace function public.consume_ask_orbis_request(p_user_id uuid, p_daily_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requests_used integer;
begin
  if p_daily_limit < 1 or p_daily_limit > 50 then
    return false;
  end if;

  insert into public.ask_orbis_usage (user_id, usage_date, requests_used)
  values (p_user_id, (pg_catalog.now() at time zone 'Asia/Kolkata')::date, 1)
  on conflict (user_id, usage_date)
  do update set requests_used = public.ask_orbis_usage.requests_used + 1
    where public.ask_orbis_usage.requests_used < p_daily_limit
  returning requests_used into v_requests_used;

  return v_requests_used is not null;
end;
$$;

revoke all on function public.consume_ask_orbis_request(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_ask_orbis_request(uuid, integer) to service_role;
