-- Orbis: one switch for every AI feature, and a record of when it was agreed to.
--
-- Until now each AI feature asked on its own (the Home brief had a toggle, the
-- advice buttons a checkbox), and the notification writer asked nobody. App
-- store rules want one clear disclosure of what goes to which AI provider, and
-- consent before anything is sent. The router reads these two columns before
-- it chooses a model, so every feature, including the push notification, is
-- covered by the same answer.
--
-- Off by default. Existing rows stay off: the owner turns AI on once, which is
-- the consent this records. ai_consented_at is stamped the first time AI is
-- turned on and kept after it is turned off, as the record that it was agreed.
--
-- ai_preferences keeps the grants and RLS it was created with in
-- 202609240022_home_brief_ai.sql: the signed-in user reads and writes only
-- their own row. service_role is granted explicitly because the router reads
-- consent with the admin client.

alter table public.ai_preferences
  add column if not exists ai_enabled boolean not null default false,
  add column if not exists ai_consented_at timestamptz;

alter table public.ai_preferences enable row level security;
revoke all on public.ai_preferences from public, anon;
grant select, insert, update, delete on public.ai_preferences to authenticated;
grant select, insert, update, delete on public.ai_preferences to service_role;

drop policy if exists "Users manage their own AI preferences" on public.ai_preferences;
create policy "Users manage their own AI preferences" on public.ai_preferences
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
