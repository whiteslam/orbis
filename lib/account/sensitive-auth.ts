import 'server-only';

import { sensitiveAuthCheck, type SensitiveRefusal } from '@/lib/account/deletion-plan';
import { signedInSession, type SignedInSession } from '@/lib/auth/session';
import { isAppUnlocked } from '@/lib/security/app-lock';
import { passwordMatches } from '@/lib/security/verify-password';

const MAX_PASSWORD_LENGTH = 200;

export type SensitiveRequester =
  | { ok: true; supabase: SignedInSession['supabase']; userId: string; email: string; claims: SignedInSession['claims'] }
  | { ok: false; reason: SensitiveRefusal };

/**
 * Who is asking to delete or export the account, and whether they have proved
 * it recently enough: signed in, Orbis unlocked here, and a sign-in in the last
 * ten minutes or the password given again. The lock is checked before any
 * password, so a locked device can't be used to test passwords.
 */
export async function sensitiveRequester(password: unknown): Promise<SensitiveRequester> {
  // Signed in comes from the shared gate; the lock is checked below, so a
  // locked device gets its own refusal rather than "signed out".
  const session = await signedInSession();
  if (!session) return { ok: false, reason: 'signed-out' };
  const { supabase, claims } = session;

  const email = typeof claims.email === 'string' ? claims.email : '';
  const nowSec = Math.floor(Date.now() / 1000);
  const unlocked = await isAppUnlocked(claims);
  let check = sensitiveAuthCheck({ amr: claims.amr, nowSec, unlocked, passwordVerified: false });
  if (!check.ok && check.needs === 'password') {
    const given = typeof password === 'string' ? password : '';
    if (!given) return { ok: false, reason: 'password' };
    const verified = given.length <= MAX_PASSWORD_LENGTH && (await passwordMatches(email, given));
    if (!verified) return { ok: false, reason: 'wrong-password' };
    check = sensitiveAuthCheck({ amr: claims.amr, nowSec, unlocked, passwordVerified: true });
  }
  if (!check.ok) return { ok: false, reason: check.needs };
  return { ok: true, supabase, userId: session.userId, email, claims };
}
