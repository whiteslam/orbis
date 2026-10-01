-- Orbis: a daily AI allowance per feature.
--
-- The Home brief (12 a day), workbook advice (5), portfolio advice (5) and
-- health plans (10) all counted against one workbook_ai_usage row. The brief
-- regenerates on its own as the day moves on, so by midday it could have used
-- the count that advice checks against, and advice was refused for the rest of
-- the day although the person had not asked for any. Each feature now counts
-- separately (lib/ai/quota.ts).
--
-- The day is India's calendar day, like Ask Orbis, so allowances reset at
-- midnight where the person is rather than at 5:30 am.
--
-- workbook_ai_usage and its function are left in place: lib/ai/quota.ts falls
-- back to them until this is applied. Safe to run more than once.

create table if not exists public.ai_feature_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  feature text not null check (feature ~ '^[a-z][a-z_]{2,39}$'),
  usage_date date not null,
  requests_used integer not null default 0 check (requests_used >= 0),
  primary key (user_id, feature, usage_date)
);

alter table public.ai_feature_usage enable row level security;
revoke all on public.ai_feature_usage from public, anon, authenticated;
grant select, insert, update, delete on public.ai_feature_usage to service_role;

create or replace function public.consume_ai_feature_request(p_user_id uuid, p_feature text, p_daily_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requests_used integer;
begin
  if p_daily_limit < 1 or p_daily_limit > 50 or p_feature !~ '^[a-z][a-z_]{2,39}$' then
    return false;
  end if;

  insert into public.ai_feature_usage (user_id, feature, usage_date, requests_used)
  values (p_user_id, p_feature, (pg_catalog.now() at time zone 'Asia/Kolkata')::date, 1)
  on conflict (user_id, feature, usage_date)
  do update set requests_used = public.ai_feature_usage.requests_used + 1
    where public.ai_feature_usage.requests_used < p_daily_limit
  returning requests_used into v_requests_used;

  return v_requests_used is not null;
end;
$$;

revoke all on function public.consume_ai_feature_request(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.consume_ai_feature_request(uuid, text, integer) to service_role;
