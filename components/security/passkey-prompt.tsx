'use client';

import { useEffect, useState, useTransition } from 'react';
import { Check, ScanFace } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { passkeyErrorMessage, supportsPasskeys } from '@/components/security/passkey-errors';

const SNOOZE_KEY = 'orbis.passkeyPrompt.snoozedUntil';
const SNOOZE_MS = 30 * 24 * 60 * 60_000;

function snoozed() {
  try {
    return Number(window.localStorage.getItem(SNOOZE_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

// "Secure your Orbis": offered until the account has a passkey or this device snoozes it.
export function PasskeyPrompt() {
  const [state, setState] = useState<'hidden' | 'offer' | 'added'>('hidden');
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supportsPasskeys() || snoozed()) return;
      const platform = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false);
      if (!platform) return;
      const { data, error } = await createClient().auth.passkey.list();
      if (!cancelled && !error && data.length === 0) setState('offer');
    })();
    return () => { cancelled = true; };
  }, []);

  function enable() {
    setMessage(null);
    startTransition(async () => {
      const { error } = await createClient().auth.registerPasskey();
      if (error) {
        setMessage(passkeyErrorMessage(error));
        return;
      }
      setState('added');
    });
  }

  function later() {
    try {
      window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    } catch {
      // Storage unavailable: the prompt simply returns next visit.
    }
    setState('hidden');
  }

  if (state === 'hidden') return null;

  if (state === 'added') {
    return (
      <section className="passkey-prompt added" role="status">
        <div className="passkey-icon"><Check size={18} aria-hidden="true" /></div>
        <div><strong>Passkey added</strong><p>Next time, unlock Orbis with your device.</p></div>
      </section>
    );
  }

  return (
    <section className="passkey-prompt" aria-labelledby="passkey-prompt-title">
      <div className="passkey-icon"><ScanFace size={18} aria-hidden="true" /></div>
      <div>
        <strong id="passkey-prompt-title">Secure your Orbis</strong>
        <p>Use Face ID, Touch ID, fingerprint or your device PIN to sign in and unlock. Orbis never sees your biometrics.</p>
        {message && <p className="passkey-error" role="alert">{message}</p>}
        <div className="passkey-actions">
          <button className="finance-button primary" type="button" onClick={enable} disabled={isPending}>{isPending ? 'Waiting for your device…' : 'Enable passkey'}</button>
          <button className="finance-button secondary" type="button" onClick={later} disabled={isPending}>Maybe later</button>
        </div>
      </div>
    </section>
  );
}
