'use server';

import { redirect } from 'next/navigation';
import { createClient as createStandaloneClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { clearAppUnlock, isAppUnlocked, unlockWithFreshAuth } from '@/lib/security/app-lock';
import { canChangePassword, MIN_PASSWORD_LENGTH } from '@/lib/security/fresh-auth';
import { ACCESS_DENIED_MESSAGE, accessAllowed, accessRestricted } from '@/lib/security/access';

export type AuthActionState = {
  error: string | null;
  message: string | null;
};

const emptyState: AuthActionState = { error: null, message: null };
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readEmail(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  return emailPattern.test(email) ? email : null;
}

// A fresh sign-in also unlocks Orbis on this device.
async function unlockForSession(supabase: Awaited<ReturnType<typeof createClient>>, accessToken: string) {
  const { data } = await supabase.auth.getClaims(accessToken);
  await unlockWithFreshAuth(data?.claims);
}

function siteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  return process.env.NODE_ENV === 'production' ? null : 'http://localhost:3000';
}

export async function signUp(formData: FormData): Promise<AuthActionState> {
  // While the installation is restricted there is no such thing as a new
  // account: the list is the list, and adding yourself to it is not a
  // self-service action.
  if (accessRestricted()) return { error: ACCESS_DENIED_MESSAGE, message: null };
  const email = readEmail(formData);
  const password = String(formData.get('password') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');

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
      emailRedirectTo: `${baseUrl}/auth/callback?next=/`,
    },
  });

  if (error) return { error: 'We could not create your account. Check your details and try again.', message: null };
  if (data.session) {
    await unlockForSession(supabase, data.session.access_token);
    redirect('/');
  }

  return {
    ...emptyState,
    message: 'Check your email for a confirmation link to finish creating your account.',
  };
}

export async function signIn(formData: FormData): Promise<AuthActionState> {
  const email = readEmail(formData);
  const password = String(formData.get('password') ?? '');

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
  redirect('/');
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

/**
 * Checks the current password without touching this browser's session: a
 * separate client with no cookie storage signs in, and that throwaway session is
 * signed out again straight away.
 */
async function currentPasswordMatches(email: string, password: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return false;
  const verifier = createStandaloneClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await verifier.auth.signInWithPassword({ email, password });
  if (error || !data.session) return false;
  await verifier.auth.signOut({ scope: 'local' }).catch(() => undefined);
  return true;
}

/**
 * Sets a new password. A recovery link opened in the last 15 minutes is enough
 * on its own; otherwise Orbis must be unlocked on this device and the current
 * password must be given, so a session left open can't be used to take over the
 * account.
 */
export async function updatePassword(formData: FormData): Promise<AuthActionState> {
  const password = String(formData.get('password') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');
  const currentPassword = String(formData.get('currentPassword') ?? '');

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
    if (!currentPassword) return { error: 'Enter your current password.', message: null };
    const email = typeof claims.email === 'string' ? claims.email : '';
    const verified = email ? await currentPasswordMatches(email, currentPassword) : false;
    if (!verified) return { error: 'Your current password isn’t right. Try again, or use “Forgot password” to get a recovery link.', message: null };
    check = canChangePassword({ amr: claims.amr, nowSec, unlocked, currentPasswordVerified: true });
  }
  if (!check.ok) {
    return check.needs === 'unlock'
      ? { error: 'Unlock Orbis on this device first, then change your password.', message: null }
      : { error: 'Enter your current password.', message: null };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === 'weak_password') return { error: 'Choose a stronger password. Avoid common or previously leaked passwords.', message: null };
    if (error.code === 'same_password') return { error: 'Choose a password you haven’t used for this account.', message: null };
    console.error('updatePassword', error.code ?? error.status);
    return { error: 'Your password could not be changed. Request a new recovery link and try again.', message: null };
  }

  redirect('/login?reset=success');
}
