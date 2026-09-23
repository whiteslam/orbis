'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addContextNoteAction, deleteContextNoteAction } from '@/app/personal/actions';
import type { ContextNote } from '@/lib/goals/memory';

export function ContextNotes({ ready, notes }: { ready: boolean; notes: ContextNote[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);

  function show(result: { success: boolean; message: string }) {
    setMessage(result.message);
    setSuccess(result.success);
    if (result.success) router.refresh();
  }

  if (!ready) return <div className="empty-state"><strong>Memory is not set up</strong><p>Apply the Orbis Memory migration in Supabase, then refresh.</p></div>;

  return <>
    <div className="memory-info"><strong>Your saved context</strong><p>These are notes you chose to save. You can review or delete them at any time. They are not included in workbook advice.</p></div>
    <form className="personal-form stack-card" onSubmit={(event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const note = new FormData(form).get('note');
      startTransition(async () => { const result = await addContextNoteAction(String(note ?? '')); show(result); if (result.success) form.reset(); });
    }}>
      <label>Save a note for yourself<textarea name="note" maxLength={1000} rows={4} required placeholder="For example: I prefer simple meal plans and have 30 minutes for exercise." /></label>
      <button className="finance-button primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save note'}</button>
    </form>
    {message && <p className={`finance-notice ${success ? 'success' : 'error'}`} role="status">{message}</p>}
    {notes.length ? <div className="memory-list">{notes.map((item) => <article className="stack-card memory-note" key={item.id}>
      <p>{item.note}</p><div><small>{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(new Date(item.updatedAt))}</small><button className="finance-button secondary" type="button" disabled={pending} onClick={() => startTransition(async () => show(await deleteContextNoteAction(item.id)))}>Delete</button></div>
    </article>)}</div> : <div className="empty-state"><strong>No saved context yet</strong><p>Add a note above when there is something you want to keep handy.</p></div>}
  </>;
}
