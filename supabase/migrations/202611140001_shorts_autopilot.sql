-- Shorts autopilot (lib/shorts/autopilot.ts): once a day, after start_time on the
-- person's clock, their Shorts PC starts one short in `style` with a fresh topic,
-- approves its plan itself and adds the finished video to the YouTube queue.
--
-- People read their own row; the app's server actions and the PC worker write
-- through the service role. Safe to run twice.

create table if not exists public.shorts_autopilot (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  style text not null default 'cozy-tales' check (style ~ '^[a-z0-9-]{2,40}$'),
  start_time time not null default '09:00',
  timezone text not null default 'Asia/Kolkata' check (char_length(timezone) between 1 and 64),
  -- The local date the autopilot last started a short: at most one a day.
  last_run_on date,
  updated_at timestamptz not null default now()
);

drop trigger if exists shorts_autopilot_set_updated_at on public.shorts_autopilot;
create trigger shorts_autopilot_set_updated_at
  before update on public.shorts_autopilot
  for each row execute function public.set_updated_at();

alter table public.shorts_autopilot enable row level security;
revoke all on public.shorts_autopilot from public, anon, authenticated;
grant select on public.shorts_autopilot to authenticated;
grant select, insert, update, delete on public.shorts_autopilot to service_role;

drop policy if exists "Users read their own shorts autopilot" on public.shorts_autopilot;
create policy "Users read their own shorts autopilot" on public.shorts_autopilot
  for select to authenticated
  using ((select auth.uid()) = user_id);
