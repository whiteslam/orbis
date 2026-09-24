-- Orbis: per-user Groww connection. API key and secret are stored encrypted
-- (AES-256-GCM, server key) and only read by server code via the service role.

create table if not exists public.groww_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  api_key_encrypted text not null,
  api_secret_encrypted text not null,
  status text not null default 'connected' check (status in ('connected', 'reconnect_required')),
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists groww_connections_set_updated_at on public.groww_connections;
create trigger groww_connections_set_updated_at
  before update on public.groww_connections
  for each row execute function public.set_updated_at();

alter table public.groww_connections enable row level security;

-- Credentials never reach the browser: no grants for anon or authenticated.
revoke all on public.groww_connections from public, anon, authenticated;
grant select, insert, update, delete on public.groww_connections to service_role;
