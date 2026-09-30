-- Signed-out waitlist for early access. Written only by the server (service role);
-- no anon or user access. Safe to run more than once.

create table if not exists public.waitlist (
  id bigint generated always as identity primary key,
  email text not null unique check (char_length(email) between 3 and 254 and email = lower(email)),
  created_at timestamptz not null default now(),
  invited_at timestamptz
);
alter table public.waitlist enable row level security;
revoke all on public.waitlist from public, anon, authenticated;
grant select, insert, update, delete on public.waitlist to service_role;
