-- Each staged upload path may be read and processed once. The primary key makes
-- the claim atomic: of any number of concurrent requests for one path, exactly
-- one insert succeeds. Rows outlive the staged file on purpose, so a signed
-- upload token reused to put a new file at the same path can't be processed
-- again. Safe to run more than once.

create table if not exists public.staged_upload_claims (
  path text primary key check (char_length(path) between 1 and 200),
  user_id uuid not null references auth.users (id) on delete cascade,
  claimed_at timestamptz not null default pg_catalog.now()
);
create index if not exists staged_upload_claims_user_claimed on public.staged_upload_claims (user_id, claimed_at);
alter table public.staged_upload_claims enable row level security;
revoke all on public.staged_upload_claims from public, anon, authenticated;
grant select, insert, delete on public.staged_upload_claims to service_role;
