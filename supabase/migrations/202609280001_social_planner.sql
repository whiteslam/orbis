-- Orbis: a private planner for the user's own social posts, month by month.
--
--   social_posts           one row per planned post
--   social_post_revisions  what changed, append-only (the user can read and add,
--                          never rewrite or delete, so history stays honest)
--   social_ai_usage        how many AI drafts were asked for today
--
-- `period` is the first day of the month the post belongs to. It is separate
-- from `planned_for` so an undated idea still belongs to a month.

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  period date not null check (extract(day from period) = 1),
  title text not null check (char_length(title) between 1 and 120),
  headline text check (headline is null or char_length(headline) <= 200),
  caption text not null default '' check (char_length(caption) <= 5000),
  hashtags text[] not null default '{}' check (coalesce(array_length(hashtags, 1), 0) <= 30),
  format text not null default 'post' check (format in ('post', 'reel', 'story')),
  platforms text[] not null default '{}'
    check (platforms <@ array['instagram','facebook','linkedin','x','threads','youtube','tiktok']::text[]),
  planned_for date,
  status text not null default 'draft' check (status in ('idea', 'draft', 'ready', 'published')),
  -- Private Storage path (<user_id>/<post_id>/<file>), never a public URL.
  media_path text,
  media_type text check (media_type is null or media_type in ('image', 'video')),
  published_at timestamptz,
  published_platform text,
  published_link text check (published_link is null or published_link ~* '^https?://'),
  -- 'ai' until the user edits the caption or title; the drawer shows an "AI draft" tag.
  source text not null default 'manual' check (source in ('manual', 'ai')),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A dated post belongs to the month of its date.
  constraint social_posts_date_in_period
    check (planned_for is null or date_trunc('month', planned_for)::date = period),
  constraint social_posts_published_has_time
    check (status <> 'published' or published_at is not null)
);

-- Ready and published posts are complete: the rule readyProblem() states, held
-- here too, so a stale check in another tab or a direct API write cannot mark an
-- unfinished post ready. Added separately so re-running this file adds it to a
-- table created by an earlier copy.
alter table public.social_posts drop constraint if exists social_posts_ready_is_complete;
alter table public.social_posts add constraint social_posts_ready_is_complete check (
  status not in ('ready', 'published')
  or (btrim(title) <> '' and caption ~ '\S' and planned_for is not null and (format = 'post' or media_path is not null))
);

create index if not exists social_posts_user_period_idx
  on public.social_posts (user_id, period, planned_for nulls last, position);

drop trigger if exists social_posts_set_updated_at on public.social_posts;
create trigger social_posts_set_updated_at
  before update on public.social_posts
  for each row execute function public.set_updated_at();

alter table public.social_posts enable row level security;
revoke all on public.social_posts from public, anon;
grant select, insert, update, delete on public.social_posts to authenticated;

drop policy if exists "Users manage their own social posts" on public.social_posts;
create policy "Users manage their own social posts" on public.social_posts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table if not exists public.social_post_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Deliberately not a foreign key: a post's history outlives the post, and the
  -- 'deleted' row is written after the post is gone. RLS keeps it the owner's.
  post_id uuid,
  post_title text not null check (char_length(post_title) between 1 and 120),
  action text not null check (action in
    ('created', 'edited', 'ai_draft', 'ready', 'unready', 'published', 'unpublished', 'moved', 'deleted')),
  -- { title, caption, ... } before and after; null where there was nothing.
  previous jsonb,
  snapshot jsonb,
  created_at timestamptz not null default now()
);

create index if not exists social_post_revisions_post_idx
  on public.social_post_revisions (user_id, post_id, created_at desc);

alter table public.social_post_revisions enable row level security;
revoke all on public.social_post_revisions from public, anon;
-- Append-only from the app's point of view: no update, no delete.
revoke update, delete on public.social_post_revisions from authenticated;
grant select, insert on public.social_post_revisions to authenticated;

drop policy if exists "Users read their own social history" on public.social_post_revisions;
create policy "Users read their own social history" on public.social_post_revisions
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users add to their own social history" on public.social_post_revisions;
create policy "Users add to their own social history" on public.social_post_revisions
  for insert to authenticated with check ((select auth.uid()) = user_id);

-- AI drafts: a daily cap, plus a short gap between requests so a double click
-- cannot generate the same month twice. Server-only, like workbook_ai_usage.
create table if not exists public.social_ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  usage_date date not null,
  requests_used integer not null default 0 check (requests_used >= 0 and requests_used <= 50),
  last_request_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

alter table public.social_ai_usage enable row level security;
revoke all on public.social_ai_usage from public, anon, authenticated;
grant select, insert, update, delete on public.social_ai_usage to service_role;

-- 'ok', 'limit' (used up today) or 'busy' (asked again within the gap).
create or replace function public.consume_social_ai_request(p_user_id uuid, p_daily_limit integer, p_gap_seconds integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.social_ai_usage%rowtype;
  v_today date := (pg_catalog.now() at time zone 'Asia/Kolkata')::date;
begin
  if p_daily_limit < 1 or p_daily_limit > 50 or p_gap_seconds < 0 or p_gap_seconds > 600 then
    return 'limit';
  end if;

  insert into public.social_ai_usage (user_id, usage_date, requests_used, last_request_at)
  values (p_user_id, v_today, 0, '-infinity')
  on conflict (user_id, usage_date) do nothing;

  select * into v_row from public.social_ai_usage
  where user_id = p_user_id and usage_date = v_today
  for update;

  if v_row.requests_used >= p_daily_limit then
    return 'limit';
  end if;
  if v_row.last_request_at > pg_catalog.now() - pg_catalog.make_interval(secs => p_gap_seconds) then
    return 'busy';
  end if;

  update public.social_ai_usage
  set requests_used = requests_used + 1, last_request_at = pg_catalog.now()
  where user_id = p_user_id and usage_date = v_today;
  return 'ok';
end;
$$;

revoke all on function public.consume_social_ai_request(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_social_ai_request(uuid, integer, integer) to service_role;

-- Private media bucket: 50 MB, pictures and short videos only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social-media', 'social-media', false, 52428800,
        array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm'])
on conflict (id) do nothing;

drop policy if exists "Users manage their own social media files" on storage.objects;
create policy "Users manage their own social media files" on storage.objects
  for all to authenticated
  using (bucket_id = 'social-media' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'social-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
