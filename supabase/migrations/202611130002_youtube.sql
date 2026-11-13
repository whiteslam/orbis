-- YouTube publishing (docs/superpowers/specs/2026-11-13-youtube-publishing-design.md).
--
-- A finished short can be queued for YouTube. A cron run (supabase/cron/
-- youtube_schedule.sql) calls the app every ten minutes; the app uploads the
-- next queued short at the person's chosen time, in slices that fit one request,
-- and keeps the resumable upload address on the row between slices. People read
-- their own rows; nobody but the service role writes (the same model as
-- shorts_jobs). The tokens live on social_connections, encrypted, and never
-- reach the browser.

-- The same connection table as Instagram and Threads, now with a third platform
-- and a refresh token (Google access tokens last an hour; the refresh token
-- does not expire until the person revokes it).
alter table public.social_connections drop constraint if exists social_connections_platform_check;
alter table public.social_connections
  add constraint social_connections_platform_check check (platform in ('instagram', 'threads', 'youtube'));

alter table public.social_connections
  add column if not exists refresh_token_encrypted text;


-- When to post. One row per person; the app creates it from their own time zone.
create table if not exists public.youtube_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  post_time time not null default '18:00',
  -- ISO weekdays: 1 = Monday ... 7 = Sunday.
  days smallint[] not null default '{1,2,3,4,5,6,7}'
    check (cardinality(days) between 1 and 7 and days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  timezone text not null default 'Asia/Kolkata' check (char_length(timezone) between 1 and 64),
  paused boolean not null default false,
  -- Set when YouTube says the daily quota or upload limit is used up: nothing is
  -- due before this moment (the start of the next local day).
  hold_until timestamptz,
  updated_at timestamptz not null default now()
);

drop trigger if exists youtube_settings_set_updated_at on public.youtube_settings;
create trigger youtube_settings_set_updated_at
  before update on public.youtube_settings
  for each row execute function public.set_updated_at();

alter table public.youtube_settings enable row level security;
revoke all on public.youtube_settings from public, anon, authenticated;
grant select on public.youtube_settings to authenticated;
grant select, insert, update, delete on public.youtube_settings to service_role;

drop policy if exists "Users read their own youtube settings" on public.youtube_settings;
create policy "Users read their own youtube settings" on public.youtube_settings
  for select to authenticated
  using ((select auth.uid()) = user_id);


-- Defaults per Shorts style, filled in on every new queue row.
create table if not exists public.youtube_presets (
  user_id uuid not null references auth.users (id) on delete cascade,
  style text not null check (style ~ '^[a-z0-9-]{2,40}$'),
  privacy text not null default 'public' check (privacy in ('public', 'unlisted', 'private')),
  category_id text not null default '24' check (category_id ~ '^[0-9]{1,3}$'),
  made_for_kids boolean not null default false,
  tags text[] not null default '{}' check (coalesce(array_length(tags, 1), 0) <= 30),
  primary key (user_id, style)
);

alter table public.youtube_presets enable row level security;
revoke all on public.youtube_presets from public, anon, authenticated;
grant select on public.youtube_presets to authenticated;
grant select, insert, update, delete on public.youtube_presets to service_role;

drop policy if exists "Users read their own youtube presets" on public.youtube_presets;
create policy "Users read their own youtube presets" on public.youtube_presets
  for select to authenticated
  using ((select auth.uid()) = user_id);


-- The queue. One row per short waiting for, going to, or already on YouTube.
create table if not exists public.youtube_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Kept (set to null) if the short is deleted, so history survives.
  job_id uuid references public.shorts_jobs (id) on delete set null,
  -- Files in the private shorts bucket.
  video_path text not null check (char_length(video_path) between 1 and 300),
  cover_path text check (cover_path is null or char_length(cover_path) <= 300),
  title text not null check (char_length(title) between 1 and 100),
  description text not null default '' check (char_length(description) <= 5000),
  tags text[] not null default '{}',
  category_id text not null check (category_id ~ '^[0-9]{1,3}$'),
  privacy text not null check (privacy in ('public', 'unlisted', 'private')),
  made_for_kids boolean not null default false,
  -- Smaller goes first.
  position integer not null,
  status text not null default 'queued' check (status in ('queued', 'uploading', 'published', 'failed', 'removed')),
  -- The resumable upload address and how far it has got, between slices.
  upload_url text check (upload_url is null or char_length(upload_url) <= 2000),
  bytes_sent bigint not null default 0 check (bytes_sent >= 0),
  upload_started_at timestamptz,
  -- Whoever is sending chunks holds this; two runs never work on one row.
  lease_until timestamptz,
  youtube_id text check (youtube_id is null or char_length(youtube_id) <= 64),
  published_privacy text check (published_privacy is null or published_privacy in ('public', 'unlisted', 'private')),
  published_at timestamptz,
  posted_by text check (posted_by is null or posted_by in ('schedule', 'manual')),
  error text check (error is null or char_length(error) <= 500),
  attempts smallint not null default 0 check (attempts between 0 and 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists youtube_queue_user_status_position_idx
  on public.youtube_queue (user_id, status, position);
create index if not exists youtube_queue_user_published_idx
  on public.youtube_queue (user_id, published_at desc);
-- One short can't be waiting or posted twice. After it is removed or failed it can be queued again.
create unique index if not exists youtube_queue_user_job_live_idx
  on public.youtube_queue (user_id, job_id)
  where job_id is not null and status in ('queued', 'uploading', 'published');

drop trigger if exists youtube_queue_set_updated_at on public.youtube_queue;
create trigger youtube_queue_set_updated_at
  before update on public.youtube_queue
  for each row execute function public.set_updated_at();

alter table public.youtube_queue enable row level security;
revoke all on public.youtube_queue from public, anon, authenticated;
grant select on public.youtube_queue to authenticated;
grant select, insert, update, delete on public.youtube_queue to service_role;

drop policy if exists "Users read their own youtube queue" on public.youtube_queue;
create policy "Users read their own youtube queue" on public.youtube_queue
  for select to authenticated
  using ((select auth.uid()) = user_id);


-- Take a row for one slice of work. One guarded update, so a "Post now" and a
-- cron run racing on the same row cannot both win: the loser gets no row back.
-- p_from is the status the caller expects ('queued' to start, 'uploading' to
-- resume). Starting also marks the row uploading and records who started it.
create or replace function public.youtube_take_row(
  p_user uuid,
  p_id uuid,
  p_from text,
  p_posted_by text,
  p_lease_seconds integer
) returns setof public.youtube_queue
language sql
security invoker
set search_path = ''
as $$
  update public.youtube_queue
  set lease_until = now() + make_interval(secs => p_lease_seconds),
      status = case when p_from = 'queued' then 'uploading' else status end,
      posted_by = case when p_from = 'queued' then p_posted_by else posted_by end,
      upload_started_at = case when p_from = 'queued' then coalesce(upload_started_at, now()) else upload_started_at end
  where id = p_id
    and user_id = p_user
    and status = p_from
    and p_from in ('queued', 'uploading')
    and (lease_until is null or lease_until < now())
  returning *;
$$;

-- Swap a queued row with its nearest queued neighbour: p_dir -1 moves it
-- earlier, 1 later. At either end, for another person's row, or for any other
-- p_dir, nothing happens.
create or replace function public.youtube_move(p_user uuid, p_id uuid, p_dir integer)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  mine integer;
  other_id uuid;
  other_pos integer;
begin
  if p_dir is null or p_dir not in (-1, 1) then
    return;
  end if;

  select position into mine
  from public.youtube_queue
  where id = p_id and user_id = p_user and status = 'queued'
  for update;
  if not found then
    return;
  end if;

  if p_dir = -1 then
    select id, position into other_id, other_pos
    from public.youtube_queue
    where user_id = p_user and status = 'queued' and position < mine
    order by position desc, id
    limit 1
    for update;
  else
    select id, position into other_id, other_pos
    from public.youtube_queue
    where user_id = p_user and status = 'queued' and position > mine
    order by position asc, id
    limit 1
    for update;
  end if;
  if not found then
    return;
  end if;

  update public.youtube_queue set position = other_pos where id = p_id;
  update public.youtube_queue set position = mine where id = other_id;
end;
$$;

revoke execute on function public.youtube_take_row(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.youtube_take_row(uuid, uuid, text, text, integer) to service_role;
revoke execute on function public.youtube_move(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.youtube_move(uuid, uuid, integer) to service_role;
