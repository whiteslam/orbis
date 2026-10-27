-- Rate limits for signed-out writes (the waitlist), which have no user id to
-- key public.rate_limit_buckets by. The key is an HMAC of the caller's address
-- made on the server (lib/security/anon-rate-key.ts), or 'global' or 'unknown';
-- a raw address is never stored. Safe to run more than once.

create table if not exists public.anon_rate_limit_buckets (
  key text not null check (key ~ '^[a-z0-9]{1,64}$'),
  bucket text not null check (bucket ~ '^[a-z_]{2,30}$'),
  window_start timestamptz not null,
  used integer not null default 0 check (used >= 0),
  primary key (key, bucket, window_start)
);
create index if not exists anon_rate_limit_buckets_window_idx on public.anon_rate_limit_buckets (window_start);
alter table public.anon_rate_limit_buckets enable row level security;
revoke all on public.anon_rate_limit_buckets from public, anon, authenticated;
grant select, insert, update, delete on public.anon_rate_limit_buckets to service_role;

-- Same shape as consume_rate_limit: one statement counts and checks, so
-- concurrent calls cannot overshoot. Windows older than a day are dropped as it
-- goes, since an address hash is only worth keeping while it is being counted.
create or replace function public.consume_anon_rate_limit(p_key text, p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz := pg_catalog.to_timestamp(pg_catalog.floor(extract(epoch from pg_catalog.now()) / p_window_seconds) * p_window_seconds);
  v_used integer;
begin
  if p_limit < 1 or p_window_seconds < 1 or p_window_seconds > 86400 then return false; end if;
  delete from public.anon_rate_limit_buckets where window_start < pg_catalog.now() - interval '1 day';
  insert into public.anon_rate_limit_buckets (key, bucket, window_start, used)
  values (p_key, p_bucket, v_window, 1)
  on conflict (key, bucket, window_start)
  do update set used = public.anon_rate_limit_buckets.used + 1
    where public.anon_rate_limit_buckets.used < p_limit
  returning used into v_used;
  return v_used is not null;
end; $$;
revoke all on function public.consume_anon_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_anon_rate_limit(text, text, integer, integer) to service_role;
