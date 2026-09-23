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
