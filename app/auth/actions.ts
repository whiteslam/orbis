'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { clearAppUnlock, unlockWithFreshAuth } from '@/lib/security/app-lock';

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
  const email = readEmail(formData);
  const password = String(formData.get('password') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');

  if (!email) return { error: 'Enter a valid email address.', message: null };
  if (password.length < 8) return { error: 'Use a password with at least 8 characters.', message: null };
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

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error?.code === 'email_not_confirmed') {
    return { error: 'Confirm your email using the link we sent before signing in. Check your inbox and spam folder.', message: null };
  }
  if (error?.code === 'invalid_credentials') {
    return { error: 'The email and password did not match. If this is a new account, create it first and confirm your email.', message: null };
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

export async function updatePassword(formData: FormData): Promise<AuthActionState> {
  const password = String(formData.get('password') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');

  if (password.length < 8) return { error: 'Use a password with at least 8 characters.', message: null };
  if (password !== confirmPassword) return { error: 'Your passwords do not match.', message: null };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: 'This recovery link is no longer valid. Request a new one and try again.', message: null };
  }

  redirect('/login?reset=success');
}
