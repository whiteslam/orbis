-- Orbis: archive routines instead of deleting them.
--
-- `active` already hides a routine from the brief and notifications; nothing set
-- it until now. `archived_at` records when it was put away, so the archive can
-- list what was retired and when, and restoring clears both.

alter table public.routines add column if not exists archived_at timestamptz;

-- Rows that were already inactive count as archived from now.
update public.routines set archived_at = now() where active = false and archived_at is null;
