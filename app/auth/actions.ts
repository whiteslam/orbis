'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

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
  if (data.session) redirect('/');

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
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: 'We could not sign you in with those details.', message: null };

  redirect('/');
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
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
