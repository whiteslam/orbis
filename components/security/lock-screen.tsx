'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { LockKeyhole } from 'lucide-react';
import { AuthShell } from '@/components/auth/auth-shell';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { unlockWithPasswordAction, unlockWithPinAction } from '@/app/security/actions';
import { PinInput } from '@/components/security/pin-input';
import type { PinStatus } from '@/lib/security/pin-store';
import { safeAction } from '@/lib/client/safe-action';

type Method = 'pin' | 'password';

// Unlock with the device PIN, or with the account password as the fallback.
export function LockScreen({ email, pinStatus }: { email: string | null; pinStatus: PinStatus }) {
  const router = useRouter();
  const [pinLocked, setPinLocked] = useState(pinStatus === 'locked');
  const [method, setMethod] = useState<Method>(pinStatus === 'active' ? 'pin' : 'password');
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<string | null>(pinStatus === 'locked' ? 'Too many wrong PINs. Unlock with your password, then set a new PIN.' : null);
  const [isPending, startTransition] = useTransition();
  const canUsePin = pinStatus === 'active' && !pinLocked;

  function choose(next: Method) {
    setMessage(null);
    setMethod(next);
  }

  function submitPin(value: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await safeAction(unlockWithPinAction)(value);
      if (result.success) return router.refresh();
      setPin('');
      setMessage(result.message);
      if (result.pinLocked) {
        setPinLocked(true);
        setMethod('password');
      }
    });
  }

  function unlockWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    setMessage(null);
    startTransition(async () => {
      const result = await safeAction(unlockWithPasswordAction)(password);
      if (!result.success) {
        setMessage(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <AuthShell centered>
      <div className="lock-heading">
        <div className="lock-icon"><LockKeyhole size={20} aria-hidden="true" /></div>
        <h1>Orbis is locked</h1>
        <p>Your personal data is protected.{email ? <><br />Signed in as <strong>{email}</strong></> : null}</p>
      </div>

      {method === 'pin' ? (
        <div className="lock-pin">
          <label htmlFor="lock-pin">Enter your PIN</label>
          <PinInput id="lock-pin" value={pin} onChange={setPin} onComplete={submitPin} disabled={isPending} autoFocus describedBy={message ? 'lock-feedback' : undefined} />
          {isPending && <p className="lock-pin-status" role="status">Checking…</p>}
        </div>
      ) : (
        <form className="auth-form lock-password" onSubmit={unlockWithPassword}>
          <label htmlFor="lock-password">Password</label>
          <input id="lock-password" name="password" type="password" autoComplete="current-password" required autoFocus aria-describedby={message ? 'lock-feedback' : undefined} />
          <button className="auth-submit" type="submit" disabled={isPending}>{isPending ? 'Unlocking…' : 'Unlock'}</button>
        </form>
      )}

      {message && <p id="lock-feedback" className="auth-feedback error" role="alert">{message}</p>}

      {method === 'pin' && <button className="lock-alt" type="button" onClick={() => choose('password')} disabled={isPending}>Use password instead</button>}
      {method === 'password' && canUsePin && <button className="lock-alt" type="button" onClick={() => choose('pin')} disabled={isPending}>Use PIN instead</button>}

      <div className="lock-signout">
        <span>Not you?</span>
        <SignOutButton />
      </div>
    </AuthShell>
  );
}
