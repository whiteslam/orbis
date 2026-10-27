'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { clearAppUnlock, isAppUnlocked, unlockWithFreshAuth } from '@/lib/security/app-lock';
import { UNLOCK_METHODS } from '@/lib/security/unlock-token';
import { canChangePassword, MIN_PASSWORD_LENGTH, type PasswordChangeCheck } from '@/lib/security/fresh-auth';
import { rateLimitRefusal } from '@/lib/security/rate-limit';
import { passwordMatches } from '@/lib/security/verify-password';
import { ACCESS_DENIED_MESSAGE, SIGNUP_CLOSED_MESSAGE, accessAllowed, signupsOpen } from '@/lib/security/access';
import { looksLikeEmail } from '@/lib/site';

export type AuthActionState = {
  error: string | null;
  message: string | null;
};

const emptyState: AuthActionState = { error: null, message: null };

/** A text field from the form; a missing field or an uploaded file reads as empty. */
function formText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function readEmail(formData: FormData) {
  const email = formText(formData, 'email').trim();
  return looksLikeEmail(email) ? email : null;
}

// A fresh sign-in also unlocks Orbis on this device.
async function unlockForSession(supabase: Awaited<ReturnType<typeof createClient>>, accessToken: string) {
  const { data } = await supabase.auth.getClaims(accessToken);
  await unlockWithFreshAuth(data?.claims, UNLOCK_METHODS.password);
}

function siteUrl() {
  let configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  while (configured?.endsWith('/')) configured = configured.slice(0, -1);
  if (configured) return configured;
  return process.env.NODE_ENV === 'production' ? null : 'http://localhost:3000';
}

export async function signUp(formData: FormData): Promise<AuthActionState> {
  // Sign-up is shut unless it was opened on purpose. Restricted or not, there is
  // no such thing here as a self-service new account: the list is the list.
  if (!signupsOpen()) return { error: SIGNUP_CLOSED_MESSAGE, message: null };
  const email = readEmail(formData);
  const password = formText(formData, 'password');
  const confirmPassword = formText(formData, 'confirmPassword');

  if (!email) return { error: 'Enter a valid email address.', message: null };
  if (password.length < MIN_PASSWORD_LENGTH) return { error: `Use a password with at least ${MIN_PASSWORD_LENGTH} characters.`, message: null };
  if (password !== confirmPassword) return { error: 'Your passwords do not match.', message: null };

  const baseUrl = siteUrl();
  if (!baseUrl) return { error: 'Account email links are not configured. Please contact the app administrator.', message: null };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${baseUrl}/auth/callback?next=/active`,
    },
  });

  if (error) return { error: 'We could not create your account. Check your details and try again.', message: null };
  if (data.session) {
    await unlockForSession(supabase, data.session.access_token);
    redirect('/active');
  }

  return {
    ...emptyState,
    message: 'Check your email for a confirmation link to finish creating your account.',
  };
}

export async function signIn(formData: FormData): Promise<AuthActionState> {
  const email = readEmail(formData);
  const password = formText(formData, 'password');

  if (!email || !password) return { error: 'Enter your email and password.', message: null };
  // Checked before the password is, so an unlisted address cannot use sign-in
  // to find out whether an account exists.
  if (!accessAllowed(email)) return { error: ACCESS_DENIED_MESSAGE, message: null };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  // One answer for a wrong password and an unconfirmed account, so sign-in
  // can't be used to learn which addresses have accounts.
  if (error?.code === 'invalid_credentials' || error?.code === 'email_not_confirmed') {
    return { error: 'That email and password didn’t work. If you just created your account, confirm it from the email we sent first.', message: null };
  }
  if (error?.status === 429) {
    return { error: 'Too many sign-in attempts. Wait a few minutes, then try again.', message: null };
  }
  if (error) {
    return { error: 'Sign-in is temporarily unavailable. Please try again shortly.', message: null };
  }

  if (data.session) await unlockForSession(supabase, data.session.access_token);
  redirect('/active');
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  await clearAppUnlock();
  redirect('/login');
}

export async function requestPasswordReset(formData: FormData): Promise<AuthActionState> {
  const email = readEmail(formData);
  if (!email) return { error: 'Enter a valid email address.', message: null };
  // A recovery mail to an unlisted address would be a way around the door.
  // It answers the same as a successful request, so nothing is revealed.
  if (!accessAllowed(email)) {
    return { ...emptyState, message: 'If that address has an account, a recovery link is on its way.' };
  }

  const baseUrl = siteUrl();
  if (!baseUrl) return { error: 'We could not send a recovery email right now. Please try again shortly.', message: null };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${baseUrl}/auth/callback?next=/reset-password`,
  });

  if (error) {
    return { error: 'We could not send a recovery email right now. Please try again shortly.', message: null };
  }

  return {
    ...emptyState,
    message: 'If an account uses that email, a password recovery link will arrive shortly.',
  };
}

const WRONG_CURRENT_PASSWORD = 'Your current password isn’t right. Try again, or use “Forgot password” to get a recovery link.';

/** Verifies the current password when the change needs it; answers the check that follows, or an error to show. */
async function checkWithCurrentPassword(claims: { sub: string; email?: unknown; amr?: unknown }, currentPassword: string, nowSec: number, unlocked: boolean): Promise<PasswordChangeCheck | string> {
  if (!currentPassword) return 'Enter your current password.';
  const email = typeof claims.email === 'string' ? claims.email : '';
  if (!email) return WRONG_CURRENT_PASSWORD;
  // Counted before every check, so an open session can't be used to guess the password.
  const limited = await rateLimitRefusal(claims.sub, 'password');
  if (limited) return limited;
  const verified = await passwordMatches(email, currentPassword);
  if (!verified) return WRONG_CURRENT_PASSWORD;
  return canChangePassword({ amr: claims.amr, nowSec, unlocked, currentPasswordVerified: true });
}

/** What to tell the person when Supabase refuses the new password. */
function updateFailure(error: { code?: string; status?: number }) {
  if (error.code === 'weak_password') return 'Choose a stronger password. Avoid common or previously leaked passwords.';
  if (error.code === 'same_password') return 'Choose a password you haven’t used for this account.';
  console.error('updatePassword', error.code ?? error.status);
  return 'Your password could not be changed. Request a new recovery link and try again.';
}

/**
 * Sets a new password. A recovery link opened in the last 15 minutes is enough
 * on its own; otherwise Orbis must be unlocked on this device and the current
 * password must be given, so a session left open can't be used to take over the
 * account.
 */
export async function updatePassword(formData: FormData): Promise<AuthActionState> {
  const password = formText(formData, 'password');
  const confirmPassword = formText(formData, 'confirmPassword');
  const currentPassword = formText(formData, 'currentPassword');

  if (password.length < MIN_PASSWORD_LENGTH) return { error: `Use a password with at least ${MIN_PASSWORD_LENGTH} characters.`, message: null };
  if (password !== confirmPassword) return { error: 'Your passwords do not match.', message: null };

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (claimsError || !claims || typeof claims.sub !== 'string') {
    return { error: 'This recovery link is no longer valid. Request a new one and try again.', message: null };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const unlocked = await isAppUnlocked(claims);
  let check = canChangePassword({ amr: claims.amr, nowSec, unlocked, currentPasswordVerified: false });
  if (!check.ok && check.needs === 'current-password') {
    const checked = await checkWithCurrentPassword({ sub: claims.sub, email: claims.email, amr: claims.amr }, currentPassword, nowSec, unlocked);
    if (typeof checked === 'string') return { error: checked, message: null };
    check = checked;
  }
  if (!check.ok) {
    return check.needs === 'unlock'
      ? { error: 'Unlock Orbis on this device first, then change your password.', message: null }
      : { error: 'Enter your current password.', message: null };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: updateFailure(error), message: null };

  redirect('/login?reset=success');
}
