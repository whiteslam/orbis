import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/auth-form';
import { AuthShell } from '@/components/auth/auth-shell';

export const metadata: Metadata = { title: 'Sign in — Orbis' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string }>;
}) {
  const params = await searchParams;
  const initialMessage = params.reset === 'success'
    ? 'Your password has been updated. Sign in with your new password.'
    : undefined;
  const linkError = params.error === 'link-expired';

  return (
    <AuthShell>
      {linkError && <p className="auth-feedback error" role="alert">That link has expired or was already used. Request a fresh password recovery email.</p>}
      <AuthForm initialMessage={initialMessage} />
    </AuthShell>
  );
}
