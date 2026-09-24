'use client';

import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { LockKeyhole, ScanFace } from 'lucide-react';
import { AuthShell } from '@/components/auth/auth-shell';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { confirmUnlockAction, unlockWithPasswordAction } from '@/app/security/actions';
import { createClient } from '@/lib/supabase/client';
import { passkeyErrorMessage, supportsPasskeys } from '@/components/security/passkey-errors';

export function LockScreen({ email }: { email: string | null }) {
  const router = useRouter();
  const [canUsePasskey, setCanUsePasskey] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const supported = supportsPasskeys();
    setCanUsePasskey(supported);
    if (!supported) setShowPassword(true);
  }, []);

  function unlockWithDevice() {
    setMessage(null);
    startTransition(async () => {
      const { error } = await createClient().auth.signInWithPasskey();
      if (error) {
        setMessage(passkeyErrorMessage(error));
        return;
      }
      const result = await confirmUnlockAction();
      if (!result.success) {
        setMessage(result.message);
        return;
      }
      router.refresh();
    });
  }

  function unlockWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    setMessage(null);
    startTransition(async () => {
      const result = await unlockWithPasswordAction(password);
      if (!result.success) {
        setMessage(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <AuthShell>
      <div className="lock-heading">
        <div className="lock-icon"><LockKeyhole size={20} aria-hidden="true" /></div>
        <h1>Orbis is locked</h1>
        <p>Your personal data is protected.{email ? <> Signed in as <strong>{email}</strong>.</> : null}</p>
      </div>

      {canUsePasskey && (
        <button className="auth-submit lock-device" type="button" onClick={unlockWithDevice} disabled={isPending}>
          <ScanFace size={17} aria-hidden="true" /> {isPending && !showPassword ? 'Waiting for your device…' : 'Unlock with device'}
        </button>
      )}

      {canUsePasskey && !showPassword && (
        <button className="lock-alt" type="button" onClick={() => setShowPassword(true)}>Use password instead</button>
      )}

      {showPassword && (
        <form className="auth-form lock-password" onSubmit={unlockWithPassword}>
          <label htmlFor="lock-password">Password</label>
          <input id="lock-password" name="password" type="password" autoComplete="current-password" required autoFocus={!canUsePasskey} aria-describedby={message ? 'lock-feedback' : undefined} />
          <button className="auth-submit" type="submit" disabled={isPending}>{isPending ? 'Unlocking…' : 'Unlock'}</button>
        </form>
      )}

      {message && <p id="lock-feedback" className="auth-feedback error" role="alert">{message}</p>}

      <div className="lock-signout">
        <span>Not you?</span>
        <SignOutButton />
      </div>
    </AuthShell>
  );
}
