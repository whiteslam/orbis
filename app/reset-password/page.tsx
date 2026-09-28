import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { PasswordResetForm } from '@/components/auth/password-reset-form';
import { hasFreshRecovery, MIN_PASSWORD_LENGTH } from '@/lib/security/fresh-auth';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Set a new password — Orbis' };

// A recovery link opened in the last 15 minutes is enough on its own. Any other
// session must also give the current password (updatePassword checks it again).
function recoveredJustNow(amr: unknown) {
  return hasFreshRecovery(amr, Math.floor(Date.now() / 1000));
}

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) redirect('/forgot-password?error=link-expired');

  const needsCurrentPassword = !recoveredJustNow(data.claims.amr);

  return (
    <AuthShell>
      <div className="auth-heading">
        <p className="eyebrow">{needsCurrentPassword ? 'ACCOUNT' : 'ACCOUNT RECOVERY'}</p>
        <h1>{needsCurrentPassword ? 'Change your password' : 'Choose a new password'}</h1>
        <p>Make it at least {MIN_PASSWORD_LENGTH} characters long.</p>
      </div>
      <PasswordResetForm mode="reset" needsCurrentPassword={needsCurrentPassword} />
      <Link className="auth-link auth-back" href="/login">Back to sign in</Link>
    </AuthShell>
  );
}
