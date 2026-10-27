import 'server-only';

import { RESEARCH_TABLES, STORAGE_BUCKETS, deletionStepIsBestEffort, deletionSteps, type DeletionStep } from '@/lib/account/deletion-plan';
import { removeUserObjects } from '@/lib/account/storage';
import { UserFacingError } from '@/lib/errors';
import { disconnectGmail } from '@/lib/gmail/connection';
import { deleteGrowwConnection } from '@/lib/invest/groww-connection';
import { deleteZerodhaConnection } from '@/lib/invest/zerodha-connection';
import { createAdminClient } from '@/lib/supabase/admin';

type Admin = ReturnType<typeof createAdminClient>;

// What the person is told when a step fails. Before the last step the account
// and its rows are all still there; only what the earlier steps removed is gone.
const FAILED: Record<DeletionStep, string> = {
  'revoke-connections': 'Your account wasn’t deleted. A connected app may already be disconnected; everything else is still there.',
  'remove-research': 'Your account wasn’t deleted yet. Your connected apps are disconnected and some of your Research desk history may already be gone, but everything else is still there. Try again in a moment.',
  'remove-storage': 'Your account wasn’t deleted yet. Your connected apps are disconnected, your Research desk history is gone and some of your stored files may already be gone, but everything else is still there. Try again in a moment.',
  'delete-user': 'Your connected apps, Research desk history and stored files were removed, but the account itself couldn’t be deleted. Try again in a moment, or ask us for help from the support page.',
  // Never shown: this step runs after the account is gone, and its failures are only logged.
  'sweep-storage': 'Your account was deleted.',
};

const NOTHING_REMOVED = 'Your account wasn’t deleted, and nothing in it has been removed. Try again in a moment.';

async function revokeConnections(userId: string) {
  // Google is asked to revoke the refresh token; the row goes either way.
  const gmail = await disconnectGmail(userId);
  if (!gmail.revoked) console.error('deleteAccount: Google did not confirm token revocation', userId);
  await deleteGrowwConnection(userId);
  await deleteZerodhaConnection(userId);
}

/**
 * Deletes every Research desk row, children first. A worker in flight sees its
 * run gone: it stops at its next check and, before it puts the memory log
 * back, finds nothing of the owner left and skips the upload.
 */
async function removeResearch(admin: Admin, userId: string) {
  for (const table of RESEARCH_TABLES) {
    const { error } = await admin.from(table).delete().eq('user_id', userId); // NOSONAR: children go before the rows they reference
    if (error) throw new Error(`Deleting ${table} failed: ${error.code ?? error.message}`);
  }
}

async function run(step: DeletionStep, admin: Admin, userId: string) {
  switch (step) {
    case 'revoke-connections':
      return revokeConnections(userId);
    case 'remove-research':
      return removeResearch(admin, userId);
    case 'remove-storage':
    case 'sweep-storage':
      // The sweep catches a file a worker or the career cron wrote between its own existence check and the first wipe.
      return removeUserObjects(admin.storage, STORAGE_BUCKETS, userId);
    case 'delete-user': {
      // Every user table references auth.users on delete cascade, so this removes the rows too.
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw error;
    }
  }
}

/**
 * Deletes an account for good, in the order `deletionSteps()` gives. The caller
 * has already checked who is asking; `email` must match the account, as a last
 * guard against deleting the wrong user.
 */
export async function deleteAccount(userId: string, email: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) {
    console.error('deleteAccount: user lookup failed', error?.code ?? error?.status);
    throw new UserFacingError(NOTHING_REMOVED);
  }
  if (!email || data.user.email?.toLowerCase() !== email.toLowerCase()) {
    console.error('deleteAccount: email does not match the account');
    throw new UserFacingError('Your account wasn’t deleted, and nothing in it has been removed. Sign out, sign in again, then try once more.');
  }

  for (const step of deletionSteps()) {
    try {
      await run(step, admin, userId); // NOSONAR: steps run in order; a later step must not start if an earlier one failed
    } catch (cause) {
      console.error(`deleteAccount: ${step} failed`, cause);
      if (deletionStepIsBestEffort(step)) continue;
      throw new UserFacingError(FAILED[step]);
    }
  }
}
