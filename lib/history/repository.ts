import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { deletedJournalDays, toJournalSnapshot, type HistoryAction, type JournalRevision, type NoteRevision } from '@/lib/history/describe';

const isMissingTable = (code?: string) => ['PGRST205', 'PGRST204', '42P01'].includes(code ?? '');

export type HistoryResult<T> = { state: 'ready' | 'setup' | 'unavailable'; items: T[] };

function toJournalRevision(row: Record<string, unknown>): JournalRevision {
  return {
    id: String(row.id),
    date: String(row.entry_date),
    action: row.action as HistoryAction,
    previous: toJournalSnapshot(row.previous),
    snapshot: toJournalSnapshot(row.snapshot),
    createdAt: String(row.created_at),
  };
}

function toNoteRevision(row: Record<string, unknown>): NoteRevision {
  return {
    id: String(row.id),
    noteId: String(row.note_id),
    action: row.action as HistoryAction,
    previous: typeof row.previous === 'string' ? row.previous : null,
    snapshot: typeof row.snapshot === 'string' ? row.snapshot : null,
    createdAt: String(row.created_at),
  };
}

/** Every change to one day's entry, newest first. */
export async function listJournalHistory(userId: string, date: string, limit = 30): Promise<HistoryResult<JournalRevision>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('journal_entry_revisions')
    .select('id,entry_date,action,previous,snapshot,created_at')
    .eq('user_id', userId)
    .eq('entry_date', date)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return { state: isMissingTable(error.code) ? 'setup' : 'unavailable', items: [] };
  return { state: 'ready', items: (data ?? []).map(toJournalRevision) };
}

/** Journal days that were deleted and not written again, with what they said. */
export async function listDeletedJournalDays(userId: string): Promise<HistoryResult<JournalRevision>> {
  const supabase = await createClient();
  const [revisions, entries] = await Promise.all([
    supabase.from('journal_entry_revisions').select('id,entry_date,action,previous,snapshot,created_at').eq('user_id', userId).eq('action', 'deleted').order('created_at', { ascending: false }).limit(60),
    supabase.from('journal_entries').select('entry_date').eq('user_id', userId).limit(2000),
  ]);
  const error = revisions.error ?? entries.error;
  if (error) return { state: isMissingTable(error.code) ? 'setup' : 'unavailable', items: [] };
  const existing = new Set((entries.data ?? []).map((row) => String(row.entry_date)));
  return { state: 'ready', items: deletedJournalDays((revisions.data ?? []).map(toJournalRevision), existing) };
}

/** Every change to one note, newest first. */
export async function listNoteHistory(userId: string, noteId: string, limit = 30): Promise<HistoryResult<NoteRevision>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('context_note_revisions')
    .select('id,note_id,action,previous,snapshot,created_at')
    .eq('user_id', userId)
    .eq('note_id', noteId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return { state: isMissingTable(error.code) ? 'setup' : 'unavailable', items: [] };
  return { state: 'ready', items: (data ?? []).map(toNoteRevision) };
}

/**
 * Notes that were deleted, newest first. Bringing one back saves it as a new
 * note, so a deleted note whose text is saved again drops off this list.
 */
export async function listDeletedNotes(userId: string): Promise<HistoryResult<NoteRevision>> {
  const supabase = await createClient();
  const [revisions, notes] = await Promise.all([
    supabase.from('context_note_revisions').select('id,note_id,action,previous,snapshot,created_at').eq('user_id', userId).eq('action', 'deleted').order('created_at', { ascending: false }).limit(30),
    supabase.from('user_context_notes').select('note').eq('user_id', userId).limit(500),
  ]);
  const error = revisions.error ?? notes.error;
  if (error) return { state: isMissingTable(error.code) ? 'setup' : 'unavailable', items: [] };
  const saved = new Set((notes.data ?? []).map((row) => String(row.note)));
  const seen = new Set<string>();
  const items = (revisions.data ?? []).map(toNoteRevision).filter((item) => {
    if (!item.previous || saved.has(item.previous) || seen.has(item.previous)) return false;
    seen.add(item.previous);
    return true;
  });
  return { state: 'ready', items };
}
