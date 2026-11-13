-- Orbis: per-person settings (time zone, currency, locale, chosen modules).
-- Anyone without a row behaves as before: Asia/Kolkata, INR, en-IN, every module.

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  timezone text not null default 'Asia/Kolkata' check (char_length(timezone) between 1 and 64),
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  locale text not null default 'en-IN' check (char_length(locale) between 2 and 35),
  modules text[] not null default '{money,health,journal,social,career}',
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

alter table public.user_settings enable row level security;
drop policy if exists "Users manage their own settings" on public.user_settings;
create policy "Users manage their own settings" on public.user_settings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update on public.user_settings to authenticated;
grant select, insert, update on public.user_settings to service_role;

-- Everyone who already has an account counts as onboarded. Their time zone
-- carries over from their notification settings when they have one.
-- Only on the first run, while the table is still empty: run again after
-- sign-up opens, it must not mark someone part-way through onboarding as done.
-- Safe to re-run: a later run inserts nothing.
insert into public.user_settings (user_id, timezone, onboarded_at)
select u.id, coalesce(np.timezone, 'Asia/Kolkata'), now()
from auth.users u
left join public.notification_preferences np on np.user_id = u.id
where not exists (select 1 from public.user_settings)
on conflict (user_id) do nothing;
