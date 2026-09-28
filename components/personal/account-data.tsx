'use client';

import { useState, useTransition } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { deleteAccountAction, purgeSocialHistoryAction } from '@/app/account/actions';
import { connectionMessage, safeAction } from '@/lib/client/safe-action';

type Message = { text: string; success: boolean } | null;

const destructive = { background: 'var(--fd-alert)', color: '#fff' } as const;

/** Clearing social post history: a quiet link that opens a confirm step in place. */
function SocialHistory() {
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [isPending, startTransition] = useTransition();

  function purge() {
    setMessage(null);
    startTransition(async () => {
      const result = await safeAction(purgeSocialHistoryAction)();
      setMessage({ text: result.message, success: result.success });
      if (result.success) setConfirming(false);
    });
  }

  return (
    <div className="fd-source" style={{ display: 'block' }}>
      <div><strong>Social post history</strong><p>Every earlier version of your social posts. Your posts themselves stay as they are.</p></div>
      {!confirming && (
        <div className="fd-act">
          <button className="fd-link alert" type="button" onClick={() => { setMessage(null); setConfirming(true); }}><Trash2 size={13} aria-hidden="true" /> Delete social post history</button>
        </div>
      )}
      {confirming && (
        <div role="group" aria-label="Confirm deleting social post history">
          <p className="fd-msg">This deletes every earlier version of every post, for good. It can’t be undone.</p>
          <div className="fd-act">
            <button type="button" style={destructive} disabled={isPending} onClick={purge}>{isPending ? 'Deleting…' : 'Delete history'}</button>
            <button type="button" className="ghost" disabled={isPending} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}
      {message && <p className={`fd-msg ${message.success ? 'ok' : 'bad'}`} role="status">{message.text}</p>}
    </div>
  );
}

/** Deleting the account: what goes, the password when it's needed, and DELETE typed out. */
function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<Message>(null);
  const [isPending, startTransition] = useTransition();
  const ready = confirm.trim() === 'DELETE';

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setMessage(null);
    startTransition(async () => {
      const result = await safeAction(deleteAccountAction)({ password: password || undefined, confirm });
      if (result.success) {
        // A full load, so nothing from the deleted account stays in memory.
        window.location.replace('/?deleted=1');
        return;
      }
      setMessage({ text: result.message, success: false });
    });
  }

  return (
    <div className="fd-source" style={{ display: 'block' }}>
      <div>
        <strong>Delete account</strong>
        <p>Deletes your account and everything in it for good: your journal, money, health, routines, social posts, notes and uploaded files. Connected apps are disconnected first. This can’t be undone, so export your data before you do this if you want a copy.</p>
      </div>
      {!open && (
        <div className="fd-act">
          <button className="fd-link alert" type="button" onClick={() => setOpen(true)}><Trash2 size={13} aria-hidden="true" /> Delete account…</button>
        </div>
      )}
      {open && (
        <form onSubmit={submit} aria-label="Delete account">
          <label className="fd-field wide" htmlFor="delete-password">
            Password
            <input id="delete-password" type="password" autoComplete="current-password" maxLength={200} value={password} onChange={(event) => setPassword(event.currentTarget.value)} disabled={isPending} placeholder="Not needed if you signed in in the last 10 minutes" />
          </label>
          <label className="fd-field wide" htmlFor="delete-confirm">
            Type DELETE to confirm
            <input id="delete-confirm" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={20} value={confirm} onChange={(event) => setConfirm(event.currentTarget.value)} disabled={isPending} placeholder="DELETE" />
          </label>
          {message && <p className="fd-msg bad" role="alert">{message.text}</p>}
          <div className="fd-act">
            <button type="submit" style={destructive} disabled={!ready || isPending}>{isPending ? 'Deleting your account…' : 'Delete my account'}</button>
            <button type="button" className="ghost" disabled={isPending} onClick={() => { setOpen(false); setPassword(''); setConfirm(''); setMessage(null); }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Downloads the export. A refusal comes back as a message shown here, never as a saved file. */
function ExportData() {
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [isPending, startTransition] = useTransition();

  function exportData(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch('/api/account/export', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(password ? { password } : {}),
          cache: 'no-store',
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { reason?: string; message?: string } | null;
          if (body?.reason === 'password' || body?.reason === 'wrong-password') setNeedsPassword(true);
          setMessage({ text: body?.message ?? 'Your data couldn’t be exported. Try again in a moment.', success: false });
          return;
        }
        const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'orbis-export.json';
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        setPassword('');
        setNeedsPassword(false);
        setMessage({ text: 'Your export has downloaded.', success: true });
      } catch {
        setMessage({ text: connectionMessage(), success: false });
      }
    });
  }

  return (
    <form className="fd-source" style={{ display: 'block' }} onSubmit={exportData} aria-label="Export my data">
      <div><strong>Your data</strong><p>Download everything Orbis holds for you as a JSON file. Stored files are listed, and you can save them from where they live in Orbis.</p></div>
      {needsPassword && (
        <label className="fd-field wide" htmlFor="export-password">
          Password
          <input id="export-password" type="password" autoComplete="current-password" maxLength={200} value={password} onChange={(event) => setPassword(event.currentTarget.value)} disabled={isPending} placeholder="Needed if you haven’t signed in in the last 10 minutes" />
        </label>
      )}
      {message && <p className={`fd-msg ${message.success ? 'ok' : 'bad'}`} role="status">{message.text}</p>}
      <div className="fd-act">
        <button type="submit" className="ghost" disabled={isPending}><Download size={13} aria-hidden="true" /> {isPending ? 'Preparing your export…' : 'Export my data'}</button>
      </div>
    </form>
  );
}

/** Your data, on your terms: take a copy, clear post history, or delete the account. */
export function AccountData() {
  return (
    <>
      <ExportData />
      <SocialHistory />
      <DeleteAccount />
    </>
  );
}
