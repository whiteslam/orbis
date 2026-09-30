'use server';

import { createAdminClient } from '@/lib/supabase/admin';

export type WaitlistResult = { ok: true } | { ok: false; message: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVALID = 'Enter a valid email address.';
const UNAVAILABLE = 'We couldn’t save that right now. Try again in a moment.';

/**
 * Adds an email to the waitlist. Signed-out, so it writes with the server key;
 * the table has no anon or user access. A repeat email succeeds quietly, so the
 * form never reveals who is already on the list.
 */
export async function joinWaitlistAction(input: { email: string; website?: string }): Promise<WaitlistResult> {
  if (!input || typeof input !== 'object' || typeof input.email !== 'string') return { ok: false, message: INVALID };
  // Honeypot: people never see this field, form-filling bots do.
  if (typeof input.website === 'string' && input.website.trim()) return { ok: true };

  const email = input.email.trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return { ok: false, message: INVALID };

  try {
    const { error } = await createAdminClient()
      .from('waitlist')
      .upsert({ email }, { onConflict: 'email', ignoreDuplicates: true });
    if (error) {
      console.error('waitlist insert failed', error);
      return { ok: false, message: UNAVAILABLE };
    }
  } catch (error) {
    console.error('waitlist insert failed', error);
    return { ok: false, message: UNAVAILABLE };
  }
  return { ok: true };
}
