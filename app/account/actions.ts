'use server';

import { revalidatePath } from 'next/cache';
import { deleteAccount } from '@/lib/account/delete';
import { deletionAuthCheck, deletionConfirmed } from '@/lib/account/deletion-plan';
import { userMessage } from '@/lib/errors';
import { clearAppUnlock, isAppUnlocked } from '@/lib/security/app-lock';
import { passwordMatches } from '@/lib/security/verify-password';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export type AccountActionState = { success: boolean; message: string; needsPassword?: boolean };

const MAX_PASSWORD_LENGTH = 200;

async function requester() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims || typeof claims.sub !== 'string') return null;
  return { supabase, claims, userId: claims.sub, unlocked: await isAppUnlocked(claims) };
}

/**
 * Deletes the signed-in person's account for good. Needs "DELETE" typed, Orbis
 * unlocked on this device, and either a sign-in in the last ten minutes or the
 * password given again. Signs this browser out once the account is gone.
 */
export async function deleteAccountAction(input: { password?: string; confirm: string }): Promise<AccountActionState> {
  const who = await requester();
  if (!who) return { success: false, message: 'Sign in again to delete your account.' };
  if (!input || typeof input !== 'object' || !deletionConfirmed(input.confirm)) {
    return { success: false, message: 'Type DELETE to confirm.' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const email = typeof who.claims.email === 'string' ? who.claims.email : '';
  let check = deletionAuthCheck({ amr: who.claims.amr, nowSec, unlocked: who.unlocked, passwordVerified: false });
  if (!check.ok && check.needs === 'password') {
    const password = typeof input.password === 'string' ? input.password : '';
    if (!password) return { success: false, needsPassword: true, message: 'Enter your password to delete your account.' };
    // The lock was checked first, so a locked device can't be used to test passwords.
    const verified = password.length <= MAX_PASSWORD_LENGTH && (await passwordMatches(email, password));
    if (!verified) return { success: false, needsPassword: true, message: 'That password isn’t right. Try again.' };
    check = deletionAuthCheck({ amr: who.claims.amr, nowSec, unlocked: who.unlocked, passwordVerified: true });
  }
  if (!check.ok) {
    return check.needs === 'unlock'
      ? { success: false, message: 'Unlock Orbis on this device first, then delete your account.' }
      : { success: false, needsPassword: true, message: 'Enter your password to delete your account.' };
  }

  try {
    await deleteAccount(who.userId, email);
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
  const who = await requester();
  if (!who) return { success: false, message: 'Sign in again to clear your post history.' };
  if (!who.unlocked) return { success: false, message: 'Unlock Orbis on this device first.' };

  try {
    const { error } = await createAdminClient().from('social_post_revisions').delete().eq('user_id', who.userId);
    if (error) throw error;
  } catch (error) {
    return { success: false, message: userMessage(error, 'Your post history couldn’t be cleared. Try again in a moment.') };
  }
  revalidatePath('/');
  return { success: true, message: 'Your social post history has been deleted. Your posts themselves are unchanged.' };
}
