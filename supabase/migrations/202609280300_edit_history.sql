-- Orbis: edit history for the journal and saved notes.
--
--   journal_entry_revisions  every change to a journal entry, keyed by its day
--   context_note_revisions   every change to a saved note
--
-- History is written by triggers, not by the app, for two reasons: a history
-- row can never describe a change that did not happen (the trigger only runs
-- when the write succeeded), and the user can read history but never write or
-- rewrite it (authenticated gets select only). Restoring an old version is an
-- ordinary edit, so it shows up as one more row, never as a rewrite.
--
-- Neither table has a foreign key to the row it describes, so a deleted entry's
-- history stays readable.

create table if not exists public.journal_entry_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  entry_date date not null,
  action text not null check (action in ('created', 'edited', 'deleted')),
  -- { mood, body, tags } before and after; null where there was nothing.
  previous jsonb,
  snapshot jsonb,
  created_at timestamptz not null default now()
);

create index if not exists journal_entry_revisions_entry_idx
  on public.journal_entry_revisions (user_id, entry_date, created_at desc);

alter table public.journal_entry_revisions enable row level security;
revoke all on public.journal_entry_revisions from public, anon, authenticated;
grant select on public.journal_entry_revisions to authenticated;

drop policy if exists "Users read their own journal history" on public.journal_entry_revisions;
create policy "Users read their own journal history" on public.journal_entry_revisions
  for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.record_journal_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.journal_entry_revisions (user_id, entry_date, action, previous, snapshot)
    values (new.user_id, new.entry_date, 'created', null,
            pg_catalog.jsonb_build_object('mood', new.mood, 'body', new.body, 'tags', pg_catalog.to_jsonb(new.tags)));
    return new;
  elsif tg_op = 'UPDATE' then
    -- Saving without changing anything is not an edit.
    if new.mood is not distinct from old.mood and new.body is not distinct from old.body and new.tags is not distinct from old.tags then
      return new;
    end if;
    insert into public.journal_entry_revisions (user_id, entry_date, action, previous, snapshot)
    values (new.user_id, new.entry_date, 'edited',
            pg_catalog.jsonb_build_object('mood', old.mood, 'body', old.body, 'tags', pg_catalog.to_jsonb(old.tags)),
            pg_catalog.jsonb_build_object('mood', new.mood, 'body', new.body, 'tags', pg_catalog.to_jsonb(new.tags)));
    return new;
  end if;
  -- A delete cascading from account removal leaves nothing to keep history for.
  if exists (select 1 from auth.users where id = old.user_id) then
    insert into public.journal_entry_revisions (user_id, entry_date, action, previous, snapshot)
    values (old.user_id, old.entry_date, 'deleted',
            pg_catalog.jsonb_build_object('mood', old.mood, 'body', old.body, 'tags', pg_catalog.to_jsonb(old.tags)), null);
  end if;
  return old;
end;
$$;

revoke all on function public.record_journal_revision() from public, anon, authenticated;

drop trigger if exists journal_entries_history on public.journal_entries;
create trigger journal_entries_history
  after insert or update or delete on public.journal_entries
  for each row execute function public.record_journal_revision();

create table if not exists public.context_note_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  note_id uuid not null,
  action text not null check (action in ('created', 'edited', 'deleted')),
  previous text,
  snapshot text,
  created_at timestamptz not null default now()
);

create index if not exists context_note_revisions_note_idx
  on public.context_note_revisions (user_id, note_id, created_at desc);

alter table public.context_note_revisions enable row level security;
revoke all on public.context_note_revisions from public, anon, authenticated;
grant select on public.context_note_revisions to authenticated;

drop policy if exists "Users read their own note history" on public.context_note_revisions;
create policy "Users read their own note history" on public.context_note_revisions
  for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.record_context_note_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.context_note_revisions (user_id, note_id, action, previous, snapshot)
    values (new.user_id, new.id, 'created', null, new.note);
    return new;
  elsif tg_op = 'UPDATE' then
    if new.note is not distinct from old.note then
      return new;
    end if;
    insert into public.context_note_revisions (user_id, note_id, action, previous, snapshot)
    values (new.user_id, new.id, 'edited', old.note, new.note);
    return new;
  end if;
  if exists (select 1 from auth.users where id = old.user_id) then
    insert into public.context_note_revisions (user_id, note_id, action, previous, snapshot)
    values (old.user_id, old.id, 'deleted', old.note, null);
  end if;
  return old;
end;
$$;

revoke all on function public.record_context_note_revision() from public, anon, authenticated;

drop trigger if exists user_context_notes_history on public.user_context_notes;
create trigger user_context_notes_history
  after insert or update or delete on public.user_context_notes
  for each row execute function public.record_context_note_revision();
