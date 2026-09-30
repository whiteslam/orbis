-- Orbis: linked Instagram and Threads accounts, so a planned post can actually
-- be published rather than only marked as published by hand.
--
-- Both are Meta APIs and both work the same way: an OAuth round trip returns a
-- short-lived token, which is exchanged for a long-lived one lasting about 60
-- days and refreshable while it is still valid. So unlike Kite this does not
-- need a daily login, but it does expire, and a token left unused past its
-- expiry cannot be refreshed and needs the user back.
--
-- Publishing is two calls in both APIs: create a media container, then publish
-- it. Media is fetched by Meta from a URL, never uploaded, which is why the
-- social-media bucket's signed URLs are what gets sent.

create table if not exists public.social_connections (
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('instagram', 'threads')),
  -- AES-256-GCM with the server key, like every other stored credential.
  access_token_encrypted text not null,
  -- The Instagram Business account id, or the Threads user id. Publishing targets it.
  account_id text not null check (char_length(account_id) between 1 and 64),
  username text check (username is null or char_length(username) <= 64),
  expires_at timestamptz,
  status text not null default 'connected' check (status in ('connected', 'reconnect_required')),
  last_published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, platform)
);

drop trigger if exists social_connections_set_updated_at on public.social_connections;
create trigger social_connections_set_updated_at
  before update on public.social_connections
  for each row execute function public.set_updated_at();

alter table public.social_connections enable row level security;

-- Tokens never reach the browser: no grants for anon or authenticated.
revoke all on public.social_connections from public, anon, authenticated;
grant select, insert, update, delete on public.social_connections to service_role;

-- What was actually published where, so a failed publish is not silent and a
-- retry cannot post twice.
alter table public.social_posts
  add column if not exists published_platform_id text
    check (published_platform_id is null or char_length(published_platform_id) <= 64);
