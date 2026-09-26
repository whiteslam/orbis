-- Orbis: per-user Zerodha (Kite Connect) session.
--
-- Unlike Groww, the key and secret are not enough to read holdings. Kite issues
-- an access token only through an interactive login, and that token dies at the
-- start of the next trading day: there is no refresh token and no server-side
-- renewal, by design. So what is stored here is a session with an expiry, and
-- the app's job is to say plainly when it has run out rather than show stale
-- numbers as though they were today's.
--
-- The API key and secret come from the server environment (ZERODHA_API_KEY and
-- ZERODHA_API_SECRET), because a Kite app is tied to one Zerodha client ID.

create table if not exists public.zerodha_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- AES-256-GCM with the server key, the same as every other stored credential.
  access_token_encrypted text not null,
  -- Whose Zerodha account this is, for the card to name it.
  kite_user_id text check (kite_user_id is null or char_length(kite_user_id) <= 40),
  expires_at timestamptz not null,
  status text not null default 'connected' check (status in ('connected', 'reconnect_required')),
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists zerodha_connections_set_updated_at on public.zerodha_connections;
create trigger zerodha_connections_set_updated_at
  before update on public.zerodha_connections
  for each row execute function public.set_updated_at();

alter table public.zerodha_connections enable row level security;

-- The session token never reaches the browser: no grants for anon or authenticated.
revoke all on public.zerodha_connections from public, anon, authenticated;
grant select, insert, update, delete on public.zerodha_connections to service_role;
