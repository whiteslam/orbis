'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { deleteVoiceNote, saveVoiceNote, voiceNoteUrl } from '@/lib/voice/repository';
import { VOICE_MAX_BYTES, VOICE_MAX_SECONDS, voiceMime } from '@/lib/voice/types';

const authed = async () => (await requireUser())?.userId ?? null;

const validId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id);

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && value <= today && value >= '2000-01-01';
}

export async function uploadVoiceNoteAction(form: FormData) {
  const userId = await authed();
  if (!userId) return { success: false, message: 'Sign in again to save a voice note.' };
  if (!(form instanceof FormData)) return { success: false, message: 'That recording is invalid.' };

  const date = form.get('date');
  const file = form.get('file');
  const duration = Math.round(Number(form.get('duration')));
  if (!validDate(date)) return { success: false, message: 'Choose a valid day (today or earlier).' };
  if (!(file instanceof Blob) || !file.size) return { success: false, message: 'Nothing was recorded. Try again.' };
  const mime = voiceMime(file.type);
  if (!mime) return { success: false, message: 'This browser recorded in a format Orbis can’t keep.' };
  if (file.size > VOICE_MAX_BYTES) return { success: false, message: 'That recording is too large. Keep it under five minutes.' };
  if (!Number.isFinite(duration) || duration < 1) return { success: false, message: 'That recording is too short.' };
  if (duration > VOICE_MAX_SECONDS + 2) return { success: false, message: 'Keep voice notes under five minutes.' };

  try {
    await saveVoiceNote(userId, { date, mime, durationSeconds: Math.min(duration, VOICE_MAX_SECONDS), file });
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Your voice note could not be saved.' };
  }
  revalidatePath('/active');
  return { success: true, message: 'Voice note saved.' };
}

export async function voiceNoteUrlAction(id: string) {
  const userId = await authed();
  if (!userId) return { success: false, message: 'Sign in again to play this.', url: null };
  if (!validId(id)) return { success: false, message: 'That voice note is invalid.', url: null };
  const url = await voiceNoteUrl(userId, id);
  return url ? { success: true, message: '', url } : { success: false, message: 'That voice note could not be loaded.', url: null };
}

export async function deleteVoiceNoteAction(id: string) {
  const userId = await authed();
  if (!userId) return { success: false, message: 'Sign in again to delete this.' };
  if (!validId(id)) return { success: false, message: 'That voice note is invalid.' };
  try {
    await deleteVoiceNote(userId, id);
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'That voice note could not be deleted.' };
  }
  revalidatePath('/active');
  return { success: true, message: 'Voice note deleted.' };
}
