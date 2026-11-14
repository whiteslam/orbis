-- Shorts shelf (lib/shorts/shelf.ts): the autopilot builds at night, one short
-- at a time, until each platform has `shelf_days` days of posts ready.
--
-- * start_time is now the start of the build window; window_end is its end.
--   A window may cross midnight (23:00–07:00, the default). The first run moves
--   existing rows to 23:00–07:00 too; a later run leaves the window alone.
-- * destinations: where autopilot shorts are posted ({youtube} for now).
-- * started_on / started_count: how many autopilot shorts started on the
--   person's local day, moved only by shorts_autopilot_start, which refuses
--   once the day's cap is reached. last_run_on stays, unused, for older workers.
-- * connected_at on the Google-backed connections: when each was last made,
--   to tell a 7-day Testing expiry from other disconnects.
--
-- Safe to run twice.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'shorts_autopilot' and column_name = 'window_end'
  ) then
    alter table public.shorts_autopilot add column window_end time not null default '07:00';
    -- Night building, the owner's choice on 2026-11-14, for the rows that exist now.
    update public.shorts_autopilot set start_time = '23:00', window_end = '07:00';
  end if;
end
$$;

alter table public.shorts_autopilot alter column start_time set default '23:00';

alter table public.shorts_autopilot
  add column if not exists shelf_days smallint not null default 3,
  add column if not exists destinations text[] not null default '{youtube}',
  add column if not exists started_on date,
  add column if not exists started_count smallint not null default 0;

alter table public.shorts_autopilot drop constraint if exists shorts_autopilot_shelf_days_check;
alter table public.shorts_autopilot add constraint shorts_autopilot_shelf_days_check check (shelf_days between 1 and 7);
alter table public.shorts_autopilot drop constraint if exists shorts_autopilot_destinations_check;
alter table public.shorts_autopilot add constraint shorts_autopilot_destinations_check
  check (cardinality(destinations) between 1 and 2 and destinations <@ array['youtube', 'instagram']);
alter table public.shorts_autopilot drop constraint if exists shorts_autopilot_started_count_check;
alter table public.shorts_autopilot add constraint shorts_autopilot_started_count_check check (started_count between 0 and 50);

-- Count one more autopilot start on p_today, unless the day already has p_cap.
-- One conditional update, so two callers can't both take the last start.
create or replace function public.shorts_autopilot_start(p_user uuid, p_today date, p_cap integer)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with moved as (
    update public.shorts_autopilot
    set started_on = p_today,
        started_count = case when started_on = p_today then started_count + 1 else 1 end
    where user_id = p_user
      and enabled
      and (started_on is distinct from p_today or started_count < p_cap)
      and p_cap >= 1
    returning 1
  )
  select exists (select 1 from moved);
$$;

revoke all on function public.shorts_autopilot_start(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.shorts_autopilot_start(uuid, date, integer) to service_role;

alter table if exists public.social_connections add column if not exists connected_at timestamptz;
alter table if exists public.gmail_connections add column if not exists connected_at timestamptz;
