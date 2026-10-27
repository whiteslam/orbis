-- Orbis: Career follow-up drafts, and daily AI allowances big enough for it.
--
-- 1. career_applications.follow_up_draft: when an application's follow-up day
--    arrives with no reply, the watcher (lib/career/watch.ts) drafts a short
--    follow-up and keeps it here until the owner presses Send. It is the
--    owner's to edit or clear, so it is in their update grant. Plain text, not
--    sent anywhere by itself.
--
-- 2. consume_ai_feature_request capped a daily allowance at 50. Career reads
--    every new job's requirements and every alert and reply email, which is
--    hundreds of AI requests a day, and the owner lifted the cost cap
--    (2026-10-27). The cap goes to 1000; each feature still names its own
--    allowance in code (lib/career/ai.ts), and anything else is unchanged.
--
-- Needs 202610270001_career.sql first. Safe to run more than once.

alter table public.career_applications
  add column if not exists follow_up_draft text;

alter table public.career_applications
  drop constraint if exists career_applications_follow_up_draft_check;

alter table public.career_applications
  add constraint career_applications_follow_up_draft_check
  check (follow_up_draft is null or char_length(follow_up_draft) between 1 and 5000);

grant update (follow_up_draft) on public.career_applications to authenticated;

create or replace function public.consume_ai_feature_request(p_user_id uuid, p_feature text, p_daily_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requests_used integer;
begin
  if p_daily_limit < 1 or p_daily_limit > 1000 or p_feature !~ '^[a-z][a-z_]{2,39}$' then
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
