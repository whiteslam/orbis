import 'server-only';

import { randomUUID } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { VOICE_MAX_PER_DAY, VOICE_TYPES, type VoiceNote } from '@/lib/voice/types';

export const VOICE_BUCKET = 'journal-voice';

const isMissingTable = (code?: string) => ['PGRST205', 'PGRST204', '42P01'].includes(code ?? '');

/** Voice notes for the given days, oldest first within a day. Empty before the migration. */
export async function listVoiceNotes(userId: string, dates: string[]): Promise<VoiceNote[]> {
  if (!dates.length) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('journal_voice_notes')
    .select('id,entry_date,duration_seconds,created_at')
    .eq('user_id', userId)
    .in('entry_date', dates)
    .order('created_at')
    .limit(300);
  if (error) return [];
  return (data ?? []).map((row) => ({
    id: String(row.id),
    date: String(row.entry_date),
    durationSeconds: Number(row.duration_seconds),
    createdAt: String(row.created_at),
  }));
}

/**
 * Stores a clip, then records it. If the record cannot be written the file is
 * removed again, so Storage never holds audio the app cannot see.
 */
export async function saveVoiceNote(userId: string, input: { date: string; mime: string; durationSeconds: number; file: Blob }) {
  const supabase = await createClient();
  const { count, error: countError } = await supabase
    .from('journal_voice_notes')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('entry_date', input.date);
  if (countError) throw new Error(isMissingTable(countError.code) ? 'Apply the voice notes migration in Supabase, then try again.' : 'Your voice note could not be saved.');
  if ((count ?? 0) >= VOICE_MAX_PER_DAY) throw new Error(`A day can hold ${VOICE_MAX_PER_DAY} voice notes. Delete one to add another.`);

  const path = `${userId}/${input.date}/${randomUUID()}.${VOICE_TYPES[input.mime]}`;
  const upload = await supabase.storage.from(VOICE_BUCKET).upload(path, input.file, { contentType: input.mime, upsert: false });
  if (upload.error) throw new Error('Your voice note could not be uploaded. Try again.');

  const { error } = await supabase.from('journal_voice_notes').insert({
    user_id: userId,
    entry_date: input.date,
    storage_path: path,
    mime_type: input.mime,
    duration_seconds: input.durationSeconds,
    size_bytes: input.file.size,
  });
  if (error) {
    await supabase.storage.from(VOICE_BUCKET).remove([path]);
    throw new Error('Your voice note could not be saved.');
  }
}

/** A short-lived link to play one clip. */
export async function voiceNoteUrl(userId: string, id: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from('journal_voice_notes').select('storage_path').eq('id', id).eq('user_id', userId).maybeSingle();
  if (!data?.storage_path) return null;
  const signed = await supabase.storage.from(VOICE_BUCKET).createSignedUrl(String(data.storage_path), 600);
  return signed.data?.signedUrl ?? null;
}

export async function deleteVoiceNote(userId: string, id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('journal_voice_notes').delete().eq('id', id).eq('user_id', userId).select('storage_path').maybeSingle();
  if (error || !data) throw new Error('That voice note could not be deleted.');
  // Best effort: the record is gone either way, and the file is private.
  await supabase.storage.from(VOICE_BUCKET).remove([String(data.storage_path)]);
}
