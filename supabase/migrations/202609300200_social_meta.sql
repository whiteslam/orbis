-- Orbis: Instagram and Threads, connected to the Social planner.
--
-- social_connections holds each platform's access token, encrypted. The browser
-- never reads this table: it has no grant for `authenticated` at all, and the
-- app reads it with the service role. social_publications records where each
-- post went out, one row per post per platform. Safe to run more than once.

create table if not exists public.social_connections (
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('instagram', 'threads')),
  account_id text not null check (char_length(account_id) between 1 and 64),
  username text not null check (char_length(username) between 1 and 64),
  access_token_encrypted text not null,
  expires_at timestamptz not null,
  status text not null default 'connected' check (status in ('connected', 'reconnect_required')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, platform)
);

drop trigger if exists social_connections_set_updated_at on public.social_connections;
create trigger social_connections_set_updated_at
  before update on public.social_connections
  for each row execute function public.set_updated_at();

alter table public.social_connections enable row level security;
revoke all on public.social_connections from public, anon, authenticated;
grant select, insert, update, delete on public.social_connections to service_role;

create table if not exists public.social_publications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  post_id uuid not null references public.social_posts (id) on delete cascade,
  platform text not null check (platform in ('instagram', 'threads')),
  -- dismissed: the person said "not published" after a match or a publish; kept so
  -- the matcher does not mark it again, and cleared when they publish it anew.
  status text not null check (status in ('processing', 'published', 'dismissed')),
  source text not null check (source in ('orbis', 'matched')),
  container_id text check (container_id is null or char_length(container_id) between 1 and 64),
  -- Set just before the publish call. Once set, the claim is never dropped on an
  -- unclear outcome: the post may already be live.
  publish_sent_at timestamptz,
  external_id text check (external_id is null or char_length(external_id) between 1 and 64),
  permalink text check (permalink is null or permalink ~* '^https://'),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, platform),
  constraint social_publications_published_complete
    check (status <> 'published' or (external_id is not null and published_at is not null))
);

create index if not exists social_publications_user_idx on public.social_publications (user_id, status);

drop trigger if exists social_publications_set_updated_at on public.social_publications;
create trigger social_publications_set_updated_at
  before update on public.social_publications
  for each row execute function public.set_updated_at();

alter table public.social_publications enable row level security;
revoke all on public.social_publications from public, anon, authenticated;
grant select on public.social_publications to authenticated;
grant select, insert, update, delete on public.social_publications to service_role;

drop policy if exists "Users read their own publications" on public.social_publications;
create policy "Users read their own publications" on public.social_publications
  for select to authenticated
  using ((select auth.uid()) = user_id);
