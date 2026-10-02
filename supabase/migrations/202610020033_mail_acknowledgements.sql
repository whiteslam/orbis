-- Orbis: important mail you have already seen, so Home stops showing it.
--
-- Home lists Gmail's Important + Primary mail from the last two weeks, read
-- live and never stored. Without a memory of what you had already dealt with,
-- the same ten messages came back on every visit. Tapping "Got it" on one
-- writes its Gmail message id here and Home leaves it out from then on.
--
-- Only the id is kept: no sender, no subject, no body. Rows older than the
-- mail window are pruned when a new one is written, so the table stays small.
--
-- Safe to run more than once.

create table if not exists public.mail_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Gmail's message id: hexadecimal, 16 characters today.
  message_id text not null check (message_id ~ '^[0-9a-fA-F]{6,32}$'),
  acknowledged_at timestamptz not null default now(),
  unique (user_id, message_id)
);

create index if not exists mail_acknowledgements_user_idx
  on public.mail_acknowledgements (user_id, acknowledged_at desc);

alter table public.mail_acknowledgements enable row level security;
revoke all on public.mail_acknowledgements from public, anon;
grant select, insert, delete on public.mail_acknowledgements to authenticated;

drop policy if exists "Users manage their own mail acknowledgements" on public.mail_acknowledgements;
create policy "Users manage their own mail acknowledgements" on public.mail_acknowledgements
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
