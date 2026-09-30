'use server';

import { revalidatePath } from 'next/cache';
import { deleteAiResult } from '@/lib/ai/results';
import { APP_LOCK_MESSAGE, isAppUnlocked } from '@/lib/security/app-lock';
import { signedInSession } from '@/lib/auth/session';
import { isUuid } from '@/lib/validate/id';

type Result = { success: true; data: null } | { success: false; message: string };

/** Removes a saved AI result, so the next visit starts from the empty state again. */
export async function deleteSavedAiResultAction(id: unknown): Promise<Result> {
  if (!isUuid(id)) return { success: false, message: 'That saved result could not be found.' };
  const session = await signedInSession();
  if (!session) return { success: false, message: 'Sign in again to delete this.' };
  if (!(await isAppUnlocked(session.claims))) return { success: false, message: APP_LOCK_MESSAGE };
  const { userId } = session;

  if (!(await deleteAiResult(userId, id))) return { success: false, message: 'That saved result could not be deleted. Try again.' };
  revalidatePath('/active');
  return { success: true, data: null };
}
