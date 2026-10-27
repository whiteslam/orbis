import { looksLikeEmail } from '@/lib/site';

// The waitlist sign-up's decisions, with the database and the throttle passed
// in, so what a stranger can learn from the answer is unit-tested.
//
// The answer carries nothing about the row. It used to name the address's place
// in the queue, and a listed address got back its old, lower place while a new
// one got the tail, which told anyone whether a given person had signed up.

export type WaitlistResult = { ok: true } | { ok: false; message: string };

export const WAITLIST_INVALID = 'Enter a valid email address.';
export const WAITLIST_UNAVAILABLE = 'We couldn’t save that right now. Try again in a moment.';

export type WaitlistDeps = {
  /** Inserts the address, leaving an existing row as it is. */
  add: (email: string) => Promise<{ error: unknown }>;
};

export async function joinWaitlist(input: unknown, deps: WaitlistDeps): Promise<WaitlistResult> {
  if (!input || typeof input !== 'object' || typeof (input as { email?: unknown }).email !== 'string') return { ok: false, message: WAITLIST_INVALID };
  const { email: raw, website } = input as { email: string; website?: unknown };
  // Honeypot: people never see this field, form-filling bots do.
  if (typeof website === 'string' && website.trim()) return { ok: true };

  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !looksLikeEmail(email)) return { ok: false, message: WAITLIST_INVALID };

  try {
    const { error } = await deps.add(email);
    if (error) {
      console.error('waitlist insert failed', error);
      return { ok: false, message: WAITLIST_UNAVAILABLE };
    }
    return { ok: true };
  } catch (error) {
    console.error('waitlist insert failed', error);
    return { ok: false, message: WAITLIST_UNAVAILABLE };
  }
}
