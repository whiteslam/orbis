-- Orbis: who is the owner (and who is an admin). Replaces email lists in the
-- environment: the Research desk follows the 'owner' role, keeping
-- ORBIS_RESEARCH_DESK_EMAILS as a fallback. Everyone without a row is a 'user'.
--
-- Roles are granted from the SQL editor or the service role, never from the app.
-- To make yourself the owner, run (with your own address):
--
--   insert into public.account_roles (user_id, role)
--   select id, 'owner' from auth.users where email = '<owner email>'
--   on conflict (user_id) do update set role = excluded.role;

create table if not exists public.account_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'user')),
  granted_at timestamptz not null default now()
);

alter table public.account_roles enable row level security;
drop policy if exists "Users read their own role" on public.account_roles;
create policy "Users read their own role" on public.account_roles
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Read-only for the person; writes come from the service role / SQL.
grant select on public.account_roles to authenticated;
grant select, insert, update, delete on public.account_roles to service_role;
