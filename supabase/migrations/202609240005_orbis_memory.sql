create table if not exists public.user_context_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  note text not null check (char_length(note) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_context_notes_user_updated_idx
  on public.user_context_notes (user_id, updated_at desc);
alter table public.user_context_notes enable row level security;
create policy "Users manage their own context notes" on public.user_context_notes
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.user_context_notes to authenticated;
