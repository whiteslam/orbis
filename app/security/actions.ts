'use server';

import { clearAppUnlock, extendAppUnlock, grantAppUnlock, isAppUnlocked, unlockWithFreshAuth } from '@/lib/security/app-lock';
import { isPinFormat, PIN_LENGTH, pinProblem } from '@/lib/security/pin';
import { checkPin, savePin } from '@/lib/security/pin-store';
import { createClient } from '@/lib/supabase/server';
import { accessAllowed } from '@/lib/security/access';

export type UnlockResult = { success: boolean; message: string | null; pinLocked?: boolean };

async function currentClaims() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = error ? null : data?.claims ?? null;
  // Every unlock path runs through here, so an address that is no longer on the
  // list cannot unlock a session it still holds. The app itself signs them out
  // on the next load; this stops them getting that far.
  if (claims && !accessAllowed(typeof claims.email === 'string' ? claims.email : null)) {
    return { supabase, claims: null };
  }
  return { supabase, claims };
}

// Heartbeat from the active app: keeps an existing unlock alive. Reports false once it has expired.
export async function touchAppLockAction(): Promise<{ unlocked: boolean }> {
  const { claims } = await currentClaims();
  return { unlocked: await extendAppUnlock(claims) };
}

export async function lockAppAction(): Promise<void> {
  await clearAppUnlock();
}

// Called right after a passkey ceremony (sign-in or unlock). The new session's JWT must show a fresh authentication.
export async function confirmUnlockAction(): Promise<UnlockResult> {
  const { claims } = await currentClaims();
  if (!claims) return { success: false, message: 'Your session ended. Sign in again.' };
  if (await unlockWithFreshAuth(claims)) return { success: true, message: null };
  return { success: false, message: 'Orbis could not confirm your device authentication. Try again or use your password.' };
}

export async function unlockWithPasswordAction(password: string): Promise<UnlockResult> {
  if (typeof password !== 'string' || !password) return { success: false, message: 'Enter your password.' };
  const { supabase, claims } = await currentClaims();
  const email = typeof claims?.email === 'string' ? claims.email : null;
  if (!email) return { success: false, message: 'Your session ended. Sign in again.' };

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error?.code === 'invalid_credentials') return { success: false, message: 'That password is not correct.' };
  if (error?.status === 429) return { success: false, message: 'Too many attempts. Wait a few minutes, then try again.' };
  if (error || !data.session) return { success: false, message: 'Unlock is temporarily unavailable. Please try again shortly.' };

  const fresh = await supabase.auth.getClaims(data.session.access_token);
  if (await unlockWithFreshAuth(fresh.data?.claims)) return { success: true, message: null };
  return { success: false, message: 'Unlock is temporarily unavailable. Please try again shortly.' };
}

export async function unlockWithPinAction(pin: string): Promise<UnlockResult> {
  if (!isPinFormat(pin)) return { success: false, message: `Enter your ${PIN_LENGTH}-digit PIN.` };
  const { claims } = await currentClaims();
  if (typeof claims?.sub !== 'string') return { success: false, message: 'Your session ended. Sign in again.' };

  const result = await checkPin(claims.sub, pin);
  if (result.outcome === 'ok') {
    return (await grantAppUnlock(claims)) ? { success: true, message: null } : { success: false, message: 'Your session ended. Sign in again.' };
  }
  if (result.outcome === 'wrong') {
    return { success: false, message: `That PIN is not correct. ${result.remaining} ${result.remaining === 1 ? 'try' : 'tries'} left.` };
  }
  if (result.outcome === 'locked') {
    return { success: false, pinLocked: true, message: 'Too many wrong PINs. Unlock with your password, then set a new PIN.' };
  }
  return { success: false, message: 'PIN unlock is unavailable right now. Use your password.' };
}

// Only an unlocked session (just signed in, or unlocked with a password or passkey) can set or replace the PIN.
export async function setPinAction(pin: string, confirmPin: string): Promise<UnlockResult> {
  const { claims } = await currentClaims();
  if (typeof claims?.sub !== 'string') return { success: false, message: 'Your session ended. Sign in again.' };
  if (!(await isAppUnlocked(claims))) return { success: false, message: 'Orbis is locked. Unlock to continue.' };

  const problem = pinProblem(pin);
  if (problem) return { success: false, message: problem };
  if (pin !== confirmPin) return { success: false, message: 'The two PINs do not match.' };
  if (!(await savePin(claims.sub, pin))) return { success: false, message: 'Your PIN could not be saved. Check that the app PIN migration is applied.' };
  return { success: true, message: null };
}
