-- Device unlock PIN. Only the salted scrypt hash is stored, and only the server (service role) can read it.
create table if not exists public.user_app_pins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  pin_hash text not null check (char_length(pin_hash) between 40 and 300),
  failed_attempts smallint not null default 0 check (failed_attempts between 0 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_app_pins enable row level security;
revoke all on public.user_app_pins from public, anon, authenticated;
grant select, insert, update, delete on public.user_app_pins to service_role;

-- Reserves one PIN attempt atomically before the hash is checked, so parallel guesses cannot exceed the limit.
-- Returns no row once 5 attempts are used; a correct PIN resets the counter.
create or replace function public.consume_app_pin_attempt(p_user_id uuid)
returns table (pin_hash text, failed_attempts smallint)
language sql
security definer
set search_path = public
as $$
  update public.user_app_pins as pins
     set failed_attempts = pins.failed_attempts + 1,
         updated_at = now()
   where pins.user_id = p_user_id
     and pins.failed_attempts < 5
  returning pins.pin_hash, pins.failed_attempts;
$$;

revoke execute on function public.consume_app_pin_attempt(uuid) from public, anon, authenticated;
grant execute on function public.consume_app_pin_attempt(uuid) to service_role;
