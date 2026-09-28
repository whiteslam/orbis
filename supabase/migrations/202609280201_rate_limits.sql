-- Per-person rate limits for costly actions (uploads, file parsing, Gmail sync)
-- and a private staging bucket that large uploads go to straight from the browser.
-- Safe to run more than once.

create table if not exists public.rate_limit_buckets (
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket text not null check (bucket ~ '^[a-z_]{2,30}$'),
  window_start timestamptz not null,
  used integer not null default 0 check (used >= 0),
  primary key (user_id, bucket, window_start)
);
alter table public.rate_limit_buckets enable row level security;
revoke all on public.rate_limit_buckets from public, anon, authenticated;
grant select, insert, update, delete on public.rate_limit_buckets to service_role;

-- Counts one use and says whether it was within the limit. The insert and the
-- conditional increment are one statement, so concurrent calls cannot overshoot.
create or replace function public.consume_rate_limit(p_user_id uuid, p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz := pg_catalog.to_timestamp(pg_catalog.floor(extract(epoch from pg_catalog.now()) / p_window_seconds) * p_window_seconds);
  v_used integer;
begin
  if p_limit < 1 or p_window_seconds < 1 then return false; end if;
  insert into public.rate_limit_buckets (user_id, bucket, window_start, used)
  values (p_user_id, p_bucket, v_window, 1)
  on conflict (user_id, bucket, window_start)
  do update set used = public.rate_limit_buckets.used + 1
    where public.rate_limit_buckets.used < p_limit
  returning used into v_used;
  return v_used is not null;
end; $$;
revoke all on function public.consume_rate_limit(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(uuid, text, integer, integer) to service_role;

-- Staging for workbooks and health documents. The browser uploads here with a
-- one-time signed token; the server reads the file and deletes it. No user policy.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('workbook-uploads', 'workbook-uploads', false, 104857600,
  array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/pdf'])
on conflict (id) do nothing;
