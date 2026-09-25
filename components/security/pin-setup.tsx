'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import { AuthShell } from '@/components/auth/auth-shell';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { setPinAction } from '@/app/security/actions';
import { PinInput } from '@/components/security/pin-input';
import { PIN_LENGTH, pinProblem } from '@/lib/security/pin-rules';
import { safeAction } from '@/lib/client/safe-action';

// Required step after sign-in until the account has a device PIN (or after too many wrong PINs).
export function PinSetup({ reset }: { reset: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<'choose' | 'confirm'>('choose');
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function chosen(value: string) {
    const problem = pinProblem(value);
    if (problem) {
      setMessage(problem);
      setFirst('');
      return;
    }
    setMessage(null);
    setStep('confirm');
  }

  function confirmed(value: string) {
    if (value !== first) {
      setMessage('The two PINs do not match. Start again.');
      setFirst('');
      setSecond('');
      setStep('choose');
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await safeAction(setPinAction)(first, value);
      if (result.success) return router.refresh();
      setMessage(result.message);
      setFirst('');
      setSecond('');
      setStep('choose');
    });
  }

  return (
    <AuthShell centered>
      <div className="lock-heading">
        <div className="lock-icon"><KeyRound size={22} strokeWidth={1.8} aria-hidden="true" /></div>
        <h1>{reset ? 'Set a new Orbis PIN' : 'Set your Orbis PIN'}</h1>
        <p>
          {reset ? 'Your old PIN was switched off after too many wrong tries. ' : ''}
          You will use this {PIN_LENGTH}-digit PIN to unlock Orbis on this device. Avoid dates and easy patterns.
        </p>
      </div>

      <div className="lock-pin">
        {step === 'choose' ? (
          <>
            <label htmlFor="pin-new">Choose a PIN</label>
            <PinInput key="new" id="pin-new" value={first} onChange={setFirst} onComplete={chosen} autoFocus describedBy={message ? 'pin-feedback' : undefined} keypad />
          </>
        ) : (
          <>
            <label htmlFor="pin-confirm">Enter it again</label>
            <PinInput key="confirm" id="pin-confirm" value={second} onChange={setSecond} onComplete={confirmed} disabled={isPending} autoFocus describedBy={message ? 'pin-feedback' : undefined} keypad />
            {isPending && <p className="lock-pin-status" role="status">Saving…</p>}
          </>
        )}
      </div>

      {message && <p id="pin-feedback" className="auth-feedback error" role="alert">{message}</p>}

      <div className="auth-foot">
        <div className="lock-signout">
          <span>Not you?</span>
          <SignOutButton variant="text" />
        </div>
      </div>
    </AuthShell>
  );
}
