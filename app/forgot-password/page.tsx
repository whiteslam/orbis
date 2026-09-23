import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { PasswordResetForm } from '@/components/auth/password-reset-form';

export const metadata: Metadata = { title: 'Forgot password — Orbis' };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <AuthShell>
      {params.error === 'link-expired' && <p className="auth-feedback error" role="alert">That recovery link has expired or was already used. Request a fresh one below.</p>}
      <div className="auth-heading">
        <p className="eyebrow">ACCOUNT RECOVERY</p>
        <h1>Forgot your password?</h1>
        <p>Enter your email and we’ll send a link to reset it.</p>
      </div>
      <PasswordResetForm mode="request" />
      <Link className="auth-link auth-back" href="/login">Back to sign in</Link>
    </AuthShell>
  );
}
