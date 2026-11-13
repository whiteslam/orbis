-- Orbis: phones. An Android phone signs in with its own device credential
-- ("Authorization: Device <deviceId>.<secret>"); only the SHA-256 hex of the
-- secret is stored. The phone never holds a person's session: it calls the
-- three SECURITY DEFINER functions below (role anon), and the signed-in person
-- manages their phones through the tables (role authenticated, RLS).
--
-- Raw text stays on the phone. signals.content is only ever a per-user
-- AES-GCM envelope. Every source starts off: a signal is stored only while its
-- source is enabled for that phone.

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  platform text not null default 'android' check (platform = 'android'),
  flavour text not null check (flavour in ('play', 'direct')),
  app_version text check (char_length(app_version) <= 20),
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  push_token text check (char_length(push_token) <= 4096),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

create index if not exists devices_user_idx on public.devices (user_id);
-- device_sync clears a token from every other row that still holds it.
create index if not exists devices_push_token_idx on public.devices (push_token) where push_token is not null;

create table if not exists public.device_sources (
  device_id uuid not null references public.devices (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null check (source in
    ('test', 'notifications', 'calendar', 'contacts', 'calls', 'health', 'usage', 'phone_state', 'location')),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (device_id, source)
);

create index if not exists device_sources_user_idx on public.device_sources (user_id);

create table if not exists public.signals (
  user_id uuid not null references auth.users (id) on delete cascade,
  id uuid not null,
  device_id uuid references public.devices (id) on delete set null,
  source text not null check (source in
    ('test', 'notifications', 'calendar', 'contacts', 'calls', 'health', 'usage', 'phone_state', 'location')),
  kind text not null check (kind ~ '^[a-z][a-z_]{0,39}$'),
  occurred_at timestamptz not null,
  content text not null check (char_length(content) <= 24000),
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists signals_user_time_idx on public.signals (user_id, occurred_at desc);
create index if not exists signals_device_idx on public.signals (device_id);

create table if not exists public.activity_ledger (
  device_id uuid not null references public.devices (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  source text not null check (source in
    ('test', 'notifications', 'calendar', 'contacts', 'calls', 'health', 'usage', 'phone_state', 'location')),
  kept integer not null default 0 check (kept >= 0),
  dropped integer not null default 0 check (dropped >= 0),
  actions integer not null default 0 check (actions >= 0),
  updated_at timestamptz not null default now(),
  primary key (device_id, day, source)
);

create index if not exists activity_ledger_user_idx on public.activity_ledger (user_id, day desc);

-- Revocation is one way: once a phone is revoked, nothing can clear or change
-- revoked_at (a stolen cookie session must not revive a revoked credential).
create or replace function public.devices_keep_revoked()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'device is revoked' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists devices_keep_revoked on public.devices;
create trigger devices_keep_revoked
  before update on public.devices
  for each row execute function public.devices_keep_revoked();

alter table public.devices enable row level security;
alter table public.device_sources enable row level security;
alter table public.signals enable row level security;
alter table public.activity_ledger enable row level security;

drop policy if exists "Users read their own devices" on public.devices;
create policy "Users read their own devices" on public.devices
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users add their own devices" on public.devices;
create policy "Users add their own devices" on public.devices
  for insert to authenticated
  with check ((select auth.uid()) = user_id and revoked_at is null);

drop policy if exists "Users update their own devices" on public.devices;
create policy "Users update their own devices" on public.devices
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users read their own device sources" on public.device_sources;
create policy "Users read their own device sources" on public.device_sources
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users update their own device sources" on public.device_sources;
create policy "Users update their own device sources" on public.device_sources
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users read their own signals" on public.signals;
create policy "Users read their own signals" on public.signals
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users delete their own signals" on public.signals;
create policy "Users delete their own signals" on public.signals
  for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users read their own ledger" on public.activity_ledger;
create policy "Users read their own ledger" on public.activity_ledger
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users delete their own ledger" on public.activity_ledger;
create policy "Users delete their own ledger" on public.activity_ledger
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Grants. The person can see every device column except the credential hash
-- and the push token, register a phone, rename or revoke it, switch a source
-- off, and delete signals and ledger rows. Signals, sources and ledger rows are
-- only ever written by device_sync below.
revoke all on public.devices from public, anon, authenticated;
revoke all on public.device_sources from public, anon, authenticated;
revoke all on public.signals from public, anon, authenticated;
revoke all on public.activity_ledger from public, anon, authenticated;

grant select (id, user_id, name, platform, flavour, app_version, created_at, last_seen_at, revoked_at)
  on public.devices to authenticated;
grant insert (user_id, name, platform, flavour, app_version, secret_hash, push_token, revoked_at)
  on public.devices to authenticated;
grant update (name, revoked_at) on public.devices to authenticated;

grant select on public.device_sources to authenticated;
grant update (enabled) on public.device_sources to authenticated;

grant select, delete on public.signals to authenticated;
grant select, delete on public.activity_ledger to authenticated;

-- Who is this phone? The user id when the secret matches and the phone is not
-- revoked, otherwise null.
create or replace function public.device_whoami(p_device uuid, p_secret text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.user_id
  from public.devices d
  where d.id = p_device
    and d.revoked_at is null
    and d.secret_hash = encode(sha256(convert_to(p_secret, 'UTF8')), 'hex');
$$;

-- One sync from a phone: heartbeat, source switches, new signals, ledger counts.
-- Returns null for an unverified phone, else {"accepted","duplicate","refused"}.
create or replace function public.device_sync(
  p_device uuid,
  p_secret text,
  p_meta jsonb,
  p_sources jsonb,
  p_signals jsonb,
  p_ledger jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_meta jsonb := coalesce(p_meta, '{}'::jsonb);
  v_sources jsonb := coalesce(p_sources, '[]'::jsonb);
  v_signals jsonb := coalesce(p_signals, '[]'::jsonb);
  v_ledger jsonb := coalesce(p_ledger, '[]'::jsonb);
  v_item jsonb;
  v_rows integer;
  v_accepted integer := 0;
  v_duplicate integer := 0;
  v_refused integer := 0;
begin
  v_user := public.device_whoami(p_device, p_secret);
  if v_user is null then
    return null;
  end if;

  if jsonb_array_length(v_signals) > 100 then
    raise exception 'too_many_signals';
  end if;

  -- A push token belongs to one app install. When this phone sends one, any other row
  -- still holding it (a stale row left by an earlier sign-in on the same handset, maybe
  -- another person's) loses it, so a push for that row can't reach whoever holds the
  -- phone now.
  if nullif(v_meta ->> 'pushToken', '') is not null then
    update public.devices
    set push_token = null
    where push_token = v_meta ->> 'pushToken'
      and id <> p_device;
  end if;

  update public.devices
  set last_seen_at = now(),
      app_version = coalesce(v_meta ->> 'appVersion', app_version),
      push_token = case
        when v_meta ? 'pushToken' then nullif(v_meta ->> 'pushToken', '')
        else push_token
      end
  where id = p_device;

  for v_item in select value from jsonb_array_elements(v_sources) loop
    insert into public.device_sources (device_id, user_id, source, enabled, updated_at)
    values (p_device, v_user, v_item ->> 'source', (v_item ->> 'enabled')::boolean, now())
    on conflict (device_id, source)
    do update set enabled = excluded.enabled, updated_at = now();
  end loop;

  for v_item in select value from jsonb_array_elements(v_signals) loop
    if exists (
      select 1 from public.device_sources s
      where s.device_id = p_device and s.source = v_item ->> 'source' and s.enabled
    ) then
      insert into public.signals (user_id, id, device_id, source, kind, occurred_at, content)
      values (
        v_user,
        (v_item ->> 'id')::uuid,
        p_device,
        v_item ->> 'source',
        v_item ->> 'kind',
        (v_item ->> 'occurredAt')::timestamptz,
        v_item ->> 'content'
      )
      on conflict do nothing;
      get diagnostics v_rows = row_count;
      if v_rows = 1 then
        v_accepted := v_accepted + 1;
      else
        v_duplicate := v_duplicate + 1;
      end if;
    else
      v_refused := v_refused + 1;
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(v_ledger) loop
    insert into public.activity_ledger (device_id, user_id, day, source, kept, dropped, actions, updated_at)
    values (
      p_device,
      v_user,
      (v_item ->> 'day')::date,
      v_item ->> 'source',
      coalesce((v_item ->> 'kept')::integer, 0),
      coalesce((v_item ->> 'dropped')::integer, 0),
      coalesce((v_item ->> 'actions')::integer, 0),
      now()
    )
    on conflict (device_id, day, source)
    do update set kept = excluded.kept,
                  dropped = excluded.dropped,
                  actions = excluded.actions,
                  updated_at = now();
  end loop;

  return jsonb_build_object('accepted', v_accepted, 'duplicate', v_duplicate, 'refused', v_refused);
end;
$$;

-- Revoke a phone with its own credential. False when the phone isn't verified
-- (wrong secret, or already revoked).
create or replace function public.device_revoke(p_device uuid, p_secret text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.device_whoami(p_device, p_secret) is null then
    return false;
  end if;
  update public.devices set revoked_at = now() where id = p_device and revoked_at is null;
  return true;
end;
$$;

revoke all on function public.device_whoami(uuid, text) from public;
revoke all on function public.device_sync(uuid, text, jsonb, jsonb, jsonb, jsonb) from public;
revoke all on function public.device_revoke(uuid, text) from public;
revoke all on function public.devices_keep_revoked() from public;
grant execute on function public.device_whoami(uuid, text) to anon, authenticated;
grant execute on function public.device_sync(uuid, text, jsonb, jsonb, jsonb, jsonb) to anon, authenticated;
grant execute on function public.device_revoke(uuid, text) to anon, authenticated;
