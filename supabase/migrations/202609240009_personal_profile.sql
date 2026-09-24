create table if not exists public.user_personal_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  preferred_name text check (preferred_name is null or char_length(btrim(preferred_name)) between 1 and 80),
  role text check (role is null or char_length(btrim(role)) between 1 and 120),
  about_me text not null default '' check (char_length(btrim(about_me)) <= 3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_personal_profiles_not_empty check (
    nullif(btrim(preferred_name), '') is not null
    or nullif(btrim(role), '') is not null
    or char_length(btrim(about_me)) > 0
  )
);

alter table public.user_personal_profiles enable row level security;

create policy "Users manage their own personal profile" on public.user_personal_profiles
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.user_personal_profiles to authenticated;
