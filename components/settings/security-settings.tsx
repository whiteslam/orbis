'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { lockAppAction, setPinAction } from '@/app/security/actions';
import { PinInput } from '@/components/security/pin-input';
import { safeAction } from '@/lib/client/safe-action';
import { PIN_LENGTH } from '@/lib/security/pin-rules';

/**
 * Lock Orbis now, or change the device PIN. The PIN is required, so there is
 * no "remove"; setPinAction itself refuses unless the app is unlocked.
 */
export function SecuritySettings() {
  const router = useRouter();
  const [changing, setChanging] = useState(false);
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  function lockNow() {
    startTransition(async () => {
      try {
        await lockAppAction();
      } finally {
        // The page re-renders as the lock screen once the unlock is gone.
        router.refresh();
      }
    });
  }

  function savePin() {
    setMessage(null);
    startTransition(async () => {
      const result = await safeAction(setPinAction)(pin, confirm);
      if (!result.success) {
        setMessage({ text: result.message ?? 'Your PIN could not be saved. Try again.', success: false });
        return;
      }
      setChanging(false);
      setPin('');
      setConfirm('');
      setMessage({ text: 'PIN changed.', success: true });
    });
  }

  return (
    <div className="pf-security">
      <div className="fd-source">
        <div><strong>Lock Orbis now</strong><p>Your PIN, password or passkey opens it again.</p></div>
        <button type="button" className="fd-button ghost" onClick={lockNow} disabled={isPending}>Lock now</button>
      </div>
      {changing ? (
        <form className="fd-source" onSubmit={(event) => { event.preventDefault(); savePin(); }}>
          <div>
            <label htmlFor="settings-new-pin">New {PIN_LENGTH}-digit PIN</label>
            <PinInput id="settings-new-pin" value={pin} onChange={setPin} disabled={isPending} />
            <label htmlFor="settings-confirm-pin">Type it again</label>
            <PinInput id="settings-confirm-pin" value={confirm} onChange={setConfirm} disabled={isPending} />
          </div>
          <div className="fd-act">
            <button type="submit" disabled={isPending || pin.length !== PIN_LENGTH || confirm.length !== PIN_LENGTH}>Save PIN</button>
            <button type="button" onClick={() => { setChanging(false); setPin(''); setConfirm(''); }} disabled={isPending}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="fd-source">
          <div><strong>Device PIN</strong><p>Opens Orbis on this device without your password.</p></div>
          <button type="button" className="fd-button ghost" onClick={() => setChanging(true)}>Change PIN</button>
        </div>
      )}
      {message && <p className={`fd-msg ${message.success ? 'ok' : 'bad'}`} role="status">{message.text}</p>}
    </div>
  );
}
