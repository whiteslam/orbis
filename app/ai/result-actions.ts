'use server';

import { revalidatePath } from 'next/cache';
import { deleteAiResult } from '@/lib/ai/results';
import { APP_LOCK_MESSAGE, isAppUnlocked } from '@/lib/security/app-lock';
import { createClient } from '@/lib/supabase/server';

type Result = { success: true; data: null } | { success: false; message: string };

/** Removes a saved AI result, so the next visit starts from the empty state again. */
export async function deleteSavedAiResultAction(id: unknown): Promise<Result> {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return { success: false, message: 'That saved result could not be found.' };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== 'string') return { success: false, message: 'Sign in again to delete this.' };
  if (!(await isAppUnlocked(data?.claims))) return { success: false, message: APP_LOCK_MESSAGE };

  if (!(await deleteAiResult(userId, id))) return { success: false, message: 'That saved result could not be deleted. Try again.' };
  revalidatePath('/');
  return { success: true, data: null };
}
