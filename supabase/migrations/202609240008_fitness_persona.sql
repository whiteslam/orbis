create table if not exists public.user_fitness_personas (
  user_id uuid primary key references auth.users (id) on delete cascade,
  persona text not null check (char_length(btrim(persona)) between 1 and 3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_fitness_personas enable row level security;

create policy "Users manage their own fitness persona" on public.user_fitness_personas
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.user_fitness_personas to authenticated;
