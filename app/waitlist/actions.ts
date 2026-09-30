'use server';

import { createAdminClient } from '@/lib/supabase/admin';

export type WaitlistResult = { ok: true; position: number | null } | { ok: false; message: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVALID = 'Enter a valid email address.';
const UNAVAILABLE = 'We couldn’t save that right now. Try again in a moment.';

/**
 * Adds an email to the waitlist and answers with its place in the queue.
 *
 * Signed-out, so it writes with the server key; the table has no anon or user
 * access, which is also why the count comes back from here rather than from a
 * query in the browser. A repeat email succeeds quietly and gets the place it
 * already had, so the form never reveals who is on the list: the answer looks
 * identical whether the address is new or not.
 */
export async function joinWaitlistAction(input: { email: string; website?: string }): Promise<WaitlistResult> {
  if (!input || typeof input !== 'object' || typeof input.email !== 'string') return { ok: false, message: INVALID };
  // Honeypot: people never see this field, form-filling bots do.
  if (typeof input.website === 'string' && input.website.trim()) return { ok: true, position: null };

  const email = input.email.trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return { ok: false, message: INVALID };

  try {
    const admin = createAdminClient();
    const { error } = await admin.from('waitlist').upsert({ email }, { onConflict: 'email', ignoreDuplicates: true });
    if (error) {
      console.error('waitlist insert failed', error);
      return { ok: false, message: UNAVAILABLE };
    }

    // Their place in the queue, from the identity column: everyone ahead of them
    // has a smaller id. A failure here is not a failed join, so the form still
    // confirms and simply doesn't name a number.
    const { data: row } = await admin.from('waitlist').select('id').eq('email', email).maybeSingle();
    if (!row) return { ok: true, position: null };
    const { count } = await admin.from('waitlist').select('id', { count: 'exact', head: true }).lte('id', row.id);
    return { ok: true, position: typeof count === 'number' && count > 0 ? count : null };
  } catch (error) {
    console.error('waitlist insert failed', error);
    return { ok: false, message: UNAVAILABLE };
  }
}
