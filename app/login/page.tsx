import type { Metadata } from 'next';
import { accessRestricted } from '@/lib/security/access';
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
  // Turned away by the allowlist, rather than by a bad password.
  const privateError = params.error === 'private';

  return (
    <AuthShell footer={<p className="auth-note">Orbis holds only what you connect or upload. It reads nothing until you ask, and it never sends, edits or deletes anything in the accounts you link.</p>}>
      {linkError && <p className="auth-feedback error" role="alert">That link has expired or was already used. Request a fresh password recovery email.</p>}
      {privateError && <p className="auth-feedback error" role="alert">Orbis is private right now and not accepting sign-ins.</p>}
      <AuthForm initialMessage={initialMessage} signupOpen={!accessRestricted()} />
    </AuthShell>
  );
}
