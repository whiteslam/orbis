'use client';

import { useEffect, useState, useTransition } from 'react';
import { clearHeadsupsAction, setHeadsupKindAction } from '@/app/headsups/actions';
import { safeAction } from '@/lib/client/safe-action';
import { HEADSUP_KINDS, KIND_LABELS, type HeadsupKind, type HeadsupsResponse } from '@/lib/headsups/types';

/** Which checks run, and a way to clear what they found. */
export function HeadsupSettings() {
  const [disabled, setDisabled] = useState<HeadsupKind[] | null>(null);
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    void fetch('/api/home/headsups?prefs=1', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() as Promise<HeadsupsResponse> : null))
      .then((result) => { if (live) setDisabled(result?.state === 'ready' ? result.disabledKinds : []); })
      .catch(() => { if (live) setDisabled([]); });
    return () => { live = false; };
  }, []);

  function toggle(kind: HeadsupKind, enabled: boolean) {
    setDisabled((current) => (current ?? []).filter((item) => item !== kind).concat(enabled ? [] : [kind]));
    startTransition(async () => {
      const result = await safeAction(setHeadsupKindAction)(kind, enabled);
      setMessage({ text: result.message, success: result.success });
    });
  }

  return (
    <div className="pf-headsups">
      <p className="fd-note tight">Orbis checks these once a day and puts anything worth knowing on Today. The checks run inside Orbis; with AI on, only the numbers behind a heads-up are sent to be worded.</p>
      {HEADSUP_KINDS.map((kind) => (
        <label className="fd-line" key={kind}>
          <span>{KIND_LABELS[kind]}</span>
          <input type="checkbox" role="switch" aria-label={KIND_LABELS[kind]} checked={!(disabled ?? []).includes(kind)} disabled={disabled === null || isPending} onChange={(event) => toggle(kind, event.target.checked)} />
        </label>
      ))}
      <div className="fd-act">
        <button type="button" disabled={isPending} onClick={() => startTransition(async () => {
          const result = await safeAction(clearHeadsupsAction)();
          setMessage({ text: result.message, success: result.success });
        })}>Clear all heads-ups</button>
      </div>
      {message && <p className={`fd-msg ${message.success ? 'ok' : 'bad'}`} role="status">{message.text}</p>}
    </div>
  );
}
