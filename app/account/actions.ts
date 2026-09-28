'use server';

import { revalidatePath } from 'next/cache';
import { deleteAccount } from '@/lib/account/delete';
import { deletionConfirmed, refusalMessage } from '@/lib/account/deletion-plan';
import { sensitiveRequester } from '@/lib/account/sensitive-auth';
import { signedInSession } from '@/lib/auth/session';
import { userMessage } from '@/lib/errors';
import { clearAppUnlock, isAppUnlocked } from '@/lib/security/app-lock';
import { createAdminClient } from '@/lib/supabase/admin';

export type AccountActionState = { success: boolean; message: string; needsPassword?: boolean };

/**
 * Deletes the signed-in person's account for good. Needs "DELETE" typed, Orbis
 * unlocked on this device, and either a sign-in in the last ten minutes or the
 * password given again. Signs this browser out once the account is gone.
 */
export async function deleteAccountAction(input: { password?: string; confirm: string }): Promise<AccountActionState> {
  if (!input || typeof input !== 'object' || !deletionConfirmed(input.confirm)) {
    return { success: false, message: 'Type DELETE to confirm.' };
  }
  const who = await sensitiveRequester(input.password);
  if (!who.ok) {
    const needsPassword = who.reason === 'password' || who.reason === 'wrong-password';
    return { success: false, needsPassword, message: refusalMessage(who.reason, 'delete your account') };
  }

  try {
    await deleteAccount(who.userId, who.email);
  } catch (error) {
    return { success: false, message: userMessage(error, 'Your account wasn’t deleted. Try again in a moment.') };
  }

  // The account is gone; clear this browser's session and unlock cookies. The
  // server-side sessions went with the user, so a failure here is harmless.
  await who.supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  await clearAppUnlock();
  return { success: true, message: 'Your account and everything in it have been deleted.' };
}

/**
 * Clears the saved history of the person's social posts. Revisions can only be
 * read and added from the browser, which keeps history honest, so clearing it is
 * this explicit action, scoped to the signed-in user.
 */
export async function purgeSocialHistoryAction(): Promise<AccountActionState> {
  const session = await signedInSession();
  if (!session) return { success: false, message: 'Sign in again to clear your post history.' };
  if (!(await isAppUnlocked(session.claims))) return { success: false, message: 'Unlock Orbis on this device first.' };
  const { userId } = session;

  try {
    const { error } = await createAdminClient().from('social_post_revisions').delete().eq('user_id', userId);
    if (error) throw error;
  } catch (error) {
    return { success: false, message: userMessage(error, 'Your post history couldn’t be cleared. Try again in a moment.') };
  }
  revalidatePath('/');
  return { success: true, message: 'Your social post history has been deleted. Your posts themselves are unchanged.' };
}
