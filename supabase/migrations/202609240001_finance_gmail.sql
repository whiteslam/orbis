-- Orbis Phase 2: owner-scoped finance data and server-only Gmail connection data.

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  direction text not null check (direction in ('expense', 'income')),
  merchant text,
  category text,
  occurred_at timestamptz not null,
  source text not null check (source in ('gmail', 'manual')),
  source_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_gmail_source_message_check
    check ((source = 'gmail' and source_message_id is not null) or source = 'manual')
);

create index if not exists transactions_user_occurred_at_idx
  on public.transactions (user_id, occurred_at desc);

create unique index if not exists transactions_gmail_source_message_uidx
  on public.transactions (user_id, source_message_id)
  where source = 'gmail' and source_message_id is not null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

drop trigger if exists transactions_set_updated_at on public.transactions;
create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

alter table public.transactions enable row level security;

grant select, insert, update, delete on public.transactions to authenticated;

drop policy if exists transactions_select_own on public.transactions;
create policy transactions_select_own on public.transactions
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists transactions_insert_own on public.transactions;
create policy transactions_insert_own on public.transactions
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists transactions_update_own on public.transactions;
create policy transactions_update_own on public.transactions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists transactions_delete_own on public.transactions;
create policy transactions_delete_own on public.transactions
  for delete to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.gmail_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  google_email text not null,
  google_user_id text not null,
  refresh_token_encrypted text not null,
  status text not null default 'connected'
    check (status in ('connected', 'reconnect_required')),
  last_sync_at timestamptz,
  incremental_sync_after text,
  incremental_sync_page_token text,
  initial_sync_page_token text,
  initial_sync_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gmail_connections_id_user_id_unique unique (id, user_id)
);

create table if not exists public.gmail_sync_messages (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  gmail_message_id text not null,
  gmail_thread_id text not null,
  received_at timestamptz not null,
  sync_state text not null default 'pending'
    check (sync_state in ('pending', 'processed', 'ignored')),
  created_at timestamptz not null default now(),
  constraint gmail_sync_messages_connection_owner_fk
    foreign key (connection_id, user_id)
    references public.gmail_connections (id, user_id)
    on delete cascade,
  constraint gmail_sync_messages_connection_message_unique
    unique (connection_id, gmail_message_id)
);

drop trigger if exists gmail_connections_set_updated_at on public.gmail_connections;
create trigger gmail_connections_set_updated_at
  before update on public.gmail_connections
  for each row execute function public.set_updated_at();

create index if not exists gmail_sync_messages_connection_state_received_idx
  on public.gmail_sync_messages (connection_id, sync_state, received_at desc);

create index if not exists gmail_sync_messages_user_id_idx
  on public.gmail_sync_messages (user_id);

alter table public.gmail_connections enable row level security;
alter table public.gmail_sync_messages enable row level security;

-- OAuth credentials and candidate metadata are only accessed from authenticated
-- server handlers through the service role, after deriving the owner from auth.
revoke all on public.gmail_connections, public.gmail_sync_messages
  from public, anon, authenticated;
grant select, insert, update, delete on public.gmail_connections, public.gmail_sync_messages
  to service_role;
