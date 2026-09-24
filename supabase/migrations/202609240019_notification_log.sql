-- Orbis: sent notifications (inbox + send log). Inserting the row for (user, slot, local date) claims that send,
-- so overlapping or retried scheduler runs can never deliver the same slot twice.

create table if not exists public.notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  slot text not null check (slot in ('morning', 'lunch', 'evening', 'night', 'test')),
  local_date date not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  title text check (title is null or char_length(title) <= 80),
  body text check (body is null or char_length(body) <= 300),
  source text check (source is null or source in ('ai', 'rules')),
  devices_sent smallint not null default 0 check (devices_sent between 0 and 50),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists notification_log_one_per_slot_day
  on public.notification_log (user_id, slot, local_date) where slot <> 'test';
create index if not exists notification_log_user_created_idx on public.notification_log (user_id, created_at desc);

alter table public.notification_log enable row level security;

-- Users can read their notifications and mark them read; sending is server-only.
drop policy if exists "Users read their notifications" on public.notification_log;
create policy "Users read their notifications" on public.notification_log
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users mark their notifications read" on public.notification_log;
create policy "Users mark their notifications read" on public.notification_log
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.notification_log from anon;
grant select on public.notification_log to authenticated;
grant update (read_at) on public.notification_log to authenticated;
grant select, insert, update, delete on public.notification_log to service_role;
