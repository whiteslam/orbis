'use server';

import { clearAppUnlock, extendAppUnlock, unlockWithFreshAuth } from '@/lib/security/app-lock';
import { createClient } from '@/lib/supabase/server';

export type UnlockResult = { success: boolean; message: string | null };

async function currentClaims() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  return { supabase, claims: error ? null : data?.claims ?? null };
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
