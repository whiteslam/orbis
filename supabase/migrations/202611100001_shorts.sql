-- Faceless Shorts (docs/superpowers/specs/2026-11-10-faceless-shorts-foundation-design.md).
--
-- The app only queues and reads. The owner's own PC runs the worker
-- (workers/shorts-studio), which claims a job, drives Claude Code with the
-- faceless-shorts skill and writes progress and results back through the
-- service role. People read their own rows; nobody but the service role writes.

create table if not exists public.shorts_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  style text not null check (style ~ '^[a-z0-9-]{2,40}$'),
  topic text not null check (char_length(topic) between 1 and 300),
  -- { seconds, voice, mode, music, endLine }
  options jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object' and octet_length(options::text) <= 4000),
  status text not null default 'queued' check (status in ('queued', 'planning', 'plan_ready', 'building', 'done', 'failed', 'cancelled')),
  stage text not null default 'plan' check (stage in ('plan', 'build')),
  -- { title, seconds, lines: [{ text, caps, shot }], sources, notes }
  plan jsonb check (plan is null or (jsonb_typeof(plan) = 'object' and octet_length(plan::text) <= 60000)),
  plan_feedback text check (plan_feedback is null or char_length(plan_feedback) <= 1000),
  -- { title, caption, hashtags, qa, seconds, files: { video, share, cover, sheet } }
  delivery jsonb check (delivery is null or (jsonb_typeof(delivery) = 'object' and octet_length(delivery::text) <= 20000)),
  error text check (error is null or char_length(error) <= 500),
  attempt smallint not null default 1 check (attempt between 1 and 50),
  started_at timestamptz,
  finished_at timestamptz,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);

create index if not exists shorts_jobs_user_created_idx on public.shorts_jobs (user_id, created_at desc);
create index if not exists shorts_jobs_active_idx on public.shorts_jobs (status) where status in ('queued', 'planning', 'building');

drop trigger if exists shorts_jobs_set_updated_at on public.shorts_jobs;
create trigger shorts_jobs_set_updated_at
  before update on public.shorts_jobs
  for each row execute function public.set_updated_at();

alter table public.shorts_jobs enable row level security;
revoke all on public.shorts_jobs from public, anon, authenticated;
grant select on public.shorts_jobs to authenticated;
grant select, insert, update, delete on public.shorts_jobs to service_role;

drop policy if exists "Users read their own shorts" on public.shorts_jobs;
create policy "Users read their own shorts" on public.shorts_jobs
  for select to authenticated
  using ((select auth.uid()) = user_id);


create table if not exists public.shorts_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null,
  -- Order within the job, from 1; the live view asks for everything after the last it has.
  seq integer not null check (seq between 1 and 100000),
  kind text not null check (kind in ('status', 'step', 'log', 'qa')),
  content text not null check (char_length(content) between 1 and 4000),
  at timestamptz not null default now(),
  unique (job_id, seq),
  foreign key (user_id, job_id) references public.shorts_jobs (user_id, id) on delete cascade
);

create index if not exists shorts_events_user_idx on public.shorts_events (user_id, at desc);

alter table public.shorts_events enable row level security;
revoke all on public.shorts_events from public, anon, authenticated;
grant select on public.shorts_events to authenticated;
grant select, insert, update, delete on public.shorts_events to service_role;

drop policy if exists "Users read their own shorts events" on public.shorts_events;
create policy "Users read their own shorts events" on public.shorts_events
  for select to authenticated
  using ((select auth.uid()) = user_id);


-- The style catalog, synced by the worker from the installed skill. Not personal.
create table if not exists public.shorts_styles (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null check (char_length(name) between 1 and 80),
  tagline text not null check (char_length(tagline) <= 300),
  best_for text not null check (char_length(best_for) <= 120),
  seconds_min smallint not null check (seconds_min between 10 and 120),
  seconds_max smallint not null check (seconds_max between 10 and 120),
  is_3d boolean not null default false,
  default_voice text not null check (default_voice ~ '^[a-z]{2}_[a-z]+$'),
  sheet_path text check (sheet_path is null or char_length(sheet_path) <= 200),
  example_title text not null default '' check (char_length(example_title) <= 200),
  position smallint not null default 0,
  synced_at timestamptz not null default now()
);

alter table public.shorts_styles enable row level security;
revoke all on public.shorts_styles from public, anon, authenticated;
grant select on public.shorts_styles to authenticated;
grant select, insert, update, delete on public.shorts_styles to service_role;

drop policy if exists "Signed-in people read the shorts styles" on public.shorts_styles;
create policy "Signed-in people read the shorts styles" on public.shorts_styles
  for select to authenticated
  using (true);


-- The owner's PC worker: one row per person whose worker has started at least once.
create table if not exists public.shorts_worker (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_seen timestamptz not null default now(),
  state text not null default 'setup' check (state in ('idle', 'busy', 'paused', 'setup')),
  note text check (note is null or char_length(note) <= 1000),
  -- [{ id, label }], from the skill's voice list.
  voices jsonb not null default '[]'::jsonb check (jsonb_typeof(voices) = 'array' and octet_length(voices::text) <= 8000),
  version text check (version is null or char_length(version) <= 40)
);

alter table public.shorts_worker enable row level security;
revoke all on public.shorts_worker from public, anon, authenticated;
grant select on public.shorts_worker to authenticated;
grant select, insert, update, delete on public.shorts_worker to service_role;

drop policy if exists "Users read their own shorts worker" on public.shorts_worker;
create policy "Users read their own shorts worker" on public.shorts_worker
  for select to authenticated
  using ((select auth.uid()) = user_id);


-- Finished files under <user>/<job>/, style sheets under styles/. Private:
-- the app hands out short-lived signed URLs after checking the owner.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shorts', 'shorts', false, 209715200, array['video/mp4', 'image/jpeg', 'image/png', 'application/json'])
on conflict (id) do nothing;
