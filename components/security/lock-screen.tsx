'use client';

import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { LockKeyhole, ScanFace } from 'lucide-react';
import { AuthShell } from '@/components/auth/auth-shell';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { confirmUnlockAction, unlockWithPasswordAction, unlockWithPinAction } from '@/app/security/actions';
import { createClient } from '@/lib/supabase/client';
import { passkeyErrorMessage, supportsPasskeys } from '@/components/security/passkey-errors';
import { PinInput } from '@/components/security/pin-input';
import type { PinStatus } from '@/lib/security/pin-store';

type Method = 'pin' | 'device' | 'password';

export function LockScreen({ email, pinStatus }: { email: string | null; pinStatus: PinStatus }) {
  const router = useRouter();
  const [canUsePasskey, setCanUsePasskey] = useState(false);
  const [method, setMethod] = useState<Method>(pinStatus === 'active' ? 'pin' : 'password');
  const [pinLocked, setPinLocked] = useState(pinStatus === 'locked');
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<string | null>(pinStatus === 'locked' ? 'Too many wrong PINs. Unlock with your password, then set a new PIN.' : null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const supported = supportsPasskeys();
    setCanUsePasskey(supported);
    if (supported && pinStatus !== 'active' && pinStatus !== 'locked') setMethod('device');
  }, [pinStatus]);

  function choose(next: Method) {
    setMessage(null);
    setMethod(next);
  }

  function submitPin(value: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await unlockWithPinAction(value);
      if (result.success) return router.refresh();
      setPin('');
      setMessage(result.message);
      if (result.pinLocked) {
        setPinLocked(true);
        setMethod('password');
      }
    });
  }

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

  const alternatives: Array<[Method, string]> = [];
  if (method !== 'pin' && pinStatus === 'active' && !pinLocked) alternatives.push(['pin', 'Use PIN instead']);
  if (method !== 'device' && canUsePasskey) alternatives.push(['device', 'Use Face ID or fingerprint']);
  if (method !== 'password') alternatives.push(['password', 'Use password instead']);

  return (
    <AuthShell>
      <div className="lock-heading">
        <div className="lock-icon"><LockKeyhole size={20} aria-hidden="true" /></div>
        <h1>Orbis is locked</h1>
        <p>Your personal data is protected.{email ? <> Signed in as <strong>{email}</strong>.</> : null}</p>
      </div>

      {method === 'pin' && (
        <div className="lock-pin">
          <label htmlFor="lock-pin">Enter your PIN</label>
          <PinInput id="lock-pin" value={pin} onChange={setPin} onComplete={submitPin} disabled={isPending} autoFocus describedBy={message ? 'lock-feedback' : undefined} />
          {isPending && <p className="lock-pin-status" role="status">Checking…</p>}
        </div>
      )}

      {method === 'device' && (
        <button className="auth-submit lock-device" type="button" onClick={unlockWithDevice} disabled={isPending}>
          <ScanFace size={17} aria-hidden="true" /> {isPending ? 'Waiting for your device…' : 'Unlock with Face ID or fingerprint'}
        </button>
      )}

      {method === 'password' && (
        <form className="auth-form lock-password" onSubmit={unlockWithPassword}>
          <label htmlFor="lock-password">Password</label>
          <input id="lock-password" name="password" type="password" autoComplete="current-password" required autoFocus aria-describedby={message ? 'lock-feedback' : undefined} />
          <button className="auth-submit" type="submit" disabled={isPending}>{isPending ? 'Unlocking…' : 'Unlock'}</button>
        </form>
      )}

      {message && <p id="lock-feedback" className="auth-feedback error" role="alert">{message}</p>}

      {alternatives.map(([next, label]) => (
        <button key={next} className="lock-alt" type="button" onClick={() => choose(next)} disabled={isPending}>{label}</button>
      ))}

      <div className="lock-signout">
        <span>Not you?</span>
        <SignOutButton />
      </div>
    </AuthShell>
  );
}
