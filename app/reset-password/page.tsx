import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { PasswordResetForm } from '@/components/auth/password-reset-form';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Set a new password — Orbis' };

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) redirect('/forgot-password?error=link-expired');

  return (
    <AuthShell>
      <div className="auth-heading">
        <p className="eyebrow">ACCOUNT RECOVERY</p>
        <h1>Choose a new password</h1>
        <p>Make it at least 8 characters long.</p>
      </div>
      <PasswordResetForm mode="reset" />
      <Link className="auth-link auth-back" href="/login">Back to sign in</Link>
    </AuthShell>
  );
}
