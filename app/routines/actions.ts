'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isAppUnlocked } from '@/lib/security/app-lock';
import { clearRoutineEvent, deleteRoutine, recordRoutineEvent, saveRoutine } from '@/lib/routines/repository';
import { ROUTINE_KINDS, type RoutineKind, type RoutineStatus } from '@/lib/routines/types';

async function authed() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== 'string' || !(await isAppUnlocked(data?.claims))) return null;
  return userId;
}

const validId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id);
const KIND_IDS = ROUTINE_KINDS.map((kind) => kind.id);

export async function saveRoutineAction(input: { id?: string; title: string; kind: string; atTime: string; days: number[] }) {
  const userId = await authed();
  if (!userId) return { success: false, message: 'Sign in again to save this.' };
  if (!input || typeof input !== 'object') return { success: false, message: 'Enter the routine details.' };

  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 60) : '';
  if (!title) return { success: false, message: 'Give it a name, like Gym or Breakfast.' };
  if (!KIND_IDS.includes(input.kind as RoutineKind)) return { success: false, message: 'Choose what kind of routine this is.' };
  if (typeof input.atTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.atTime)) return { success: false, message: 'Choose a time.' };
  const days = Array.isArray(input.days) ? Array.from(new Set(input.days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))).sort() : [];
  if (!days.length) return { success: false, message: 'Pick at least one day.' };
  if (input.id !== undefined && !validId(input.id)) return { success: false, message: 'That routine is invalid.' };

  try {
    await saveRoutine(userId, { title, kind: input.kind as RoutineKind, atTime: input.atTime, days }, input.id);
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'That routine could not be saved.' };
  }
  revalidatePath('/');
  return { success: true, message: input.id ? 'Routine updated.' : `${title} added.` };
}

export async function deleteRoutineAction(id: string) {
  const userId = await authed();
  if (!userId) return { success: false, message: 'Sign in again to remove this.' };
  if (!validId(id)) return { success: false, message: 'That routine is invalid.' };
  try {
    await deleteRoutine(userId, id);
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'That routine could not be removed.' };
  }
  revalidatePath('/');
  return { success: true, message: 'Routine removed. What you already logged against it is kept.' };
}

/**
 * Answers a routine for today: done, skipped, or something else with a note.
 *
 * This is the record half of the brief's loop. Passing status null clears the
 * answer, so a mis-tap is undoable rather than permanent.
 */
export async function answerRoutineAction(input: { routineId: string; title: string; status: string | null; note?: string }) {
  const userId = await authed();
  if (!userId) return { success: false, message: 'Sign in again to save this.' };
  if (!input || typeof input !== 'object' || !validId(input.routineId)) return { success: false, message: 'That routine is invalid.' };
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 60) : '';
  if (!title) return { success: false, message: 'That routine is invalid.' };

  if (input.status === null) {
    await clearRoutineEvent(userId, input.routineId);
    revalidatePath('/');
    return { success: true, message: 'Cleared.' };
  }
  if (!['done', 'skipped', 'other'].includes(input.status ?? '')) return { success: false, message: 'Choose done, skipped, or something else.' };
  const status = input.status as RoutineStatus;
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 200) : '';
  if (status === 'other' && !note) return { success: false, message: 'Say what you did instead.' };

  try {
    await recordRoutineEvent(userId, { routineId: input.routineId, title, status, note: note || null });
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'That could not be saved.' };
  }
  revalidatePath('/');
  return {
    success: true,
    message: status === 'done' ? 'Logged.' : status === 'skipped' ? 'Noted.' : 'Logged what you did instead.',
  };
}
