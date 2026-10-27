'use server';

import { joinWaitlist, type WaitlistResult } from '@/lib/marketing/join-waitlist';
import { createAdminClient } from '@/lib/supabase/admin';

export type { WaitlistResult } from '@/lib/marketing/join-waitlist';

/**
 * Adds an email to the waitlist.
 *
 * Signed-out, so it writes with the server key; the table has no anon or user
 * access. A repeat email succeeds quietly and gets exactly the answer a new one
 * does, so the form never reveals who is on the list (lib/marketing/join-waitlist.ts).
 */
export async function joinWaitlistAction(input: { email: string; website?: string }): Promise<WaitlistResult> {
  return joinWaitlist(input, {
    add: async (email) => createAdminClient().from('waitlist').upsert({ email }, { onConflict: 'email', ignoreDuplicates: true }),
  });
}
