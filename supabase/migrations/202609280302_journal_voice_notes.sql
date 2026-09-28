-- Orbis: voice notes on journal days.
--
-- A voice note belongs to a day, not to an entry row, because an entry is one
-- row per day and is replaced on every save. The audio lives in a private
-- bucket under <user_id>/…, and is only ever served through a short-lived
-- signed URL.

create table if not exists public.journal_voice_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  entry_date date not null,
  storage_path text not null unique,
  mime_type text not null check (mime_type ~ '^audio/'),
  duration_seconds integer not null check (duration_seconds between 1 and 300),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  created_at timestamptz not null default now()
);

create index if not exists journal_voice_notes_day_idx
  on public.journal_voice_notes (user_id, entry_date, created_at);

alter table public.journal_voice_notes enable row level security;
revoke all on public.journal_voice_notes from public, anon;
grant select, insert, delete on public.journal_voice_notes to authenticated;

drop policy if exists "Users manage their own voice notes" on public.journal_voice_notes;
create policy "Users manage their own voice notes" on public.journal_voice_notes
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Private audio bucket. 10 MB is well above what a five-minute clip needs in
-- any browser's recording format, so the cap only stops abuse.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('journal-voice', 'journal-voice', false, 10485760,
        array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav'])
on conflict (id) do nothing;

drop policy if exists "Users manage their own voice files" on storage.objects;
create policy "Users manage their own voice files" on storage.objects
  for all to authenticated
  using (bucket_id = 'journal-voice' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'journal-voice' and (storage.foldername(name))[1] = (select auth.uid())::text);
