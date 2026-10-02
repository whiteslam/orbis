'use server';

import { requireUser } from '@/lib/auth/session';
import { isMissingTable } from '@/lib/supabase/errors';

// Home lists mail from the last two weeks; an acknowledgement older than this
// can never match anything again.
const KEEP_DAYS = 30;

/**
 * "Got it" on a mail in Home: remember its Gmail id so it is not shown again.
 * Only the id is stored. Saying it twice is fine.
 */
export async function acknowledgeMailAction(messageId: unknown): Promise<{ success: boolean; message: string }> {
  if (typeof messageId !== 'string' || !/^[0-9a-fA-F]{6,32}$/.test(messageId)) return { success: false, message: 'That mail could not be found.' };
  const auth = await requireUser();
  if (!auth) return { success: false, message: 'Sign in again to do this.' };

  const { error } = await auth.supabase
    .from('mail_acknowledgements')
    .upsert({ user_id: auth.userId, message_id: messageId }, { onConflict: 'user_id,message_id', ignoreDuplicates: true });
  if (error) {
    if (!isMissingTable(error)) console.error('Acknowledging a mail failed', error);
    return { success: false, message: isMissingTable(error) ? 'Apply the mail migration in Supabase, then try again.' : 'That could not be saved. Try again.' };
  }

  // Housekeeping, not part of the answer: a failure here changes nothing the person sees.
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString();
  await auth.supabase.from('mail_acknowledgements').delete().eq('user_id', auth.userId).lt('acknowledged_at', cutoff);

  return { success: true, message: 'Got it.' };
}
