'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addContextNoteAction, deleteContextNoteAction } from '@/app/personal/actions';
import type { ContextNote } from '@/lib/goals/memory';
import { safeAction } from '@/lib/client/safe-action';

/** Notes shown before "N more notes". */
const NOTES_PREVIEW = 3;

export function ContextNotes({ ready, notes }: { ready: boolean; notes: ContextNote[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const [showAll, setShowAll] = useState(false);

  function show(result: { success: boolean; message: string }) {
    setMessage(result.message);
    setSuccess(result.success);
    if (result.success) router.refresh();
  }

  if (!ready) return <p className="fd-msg bad">Saved notes aren’t set up yet. Apply the Orbis Memory migration in Supabase, then refresh.</p>;

  const shown = showAll ? notes : notes.slice(0, NOTES_PREVIEW);
  const hidden = notes.length - NOTES_PREVIEW;

  return <>
    <form className="fd-form" onSubmit={(event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const note = new FormData(form).get('note');
      startTransition(async () => { const result = await safeAction(addContextNoteAction)(String(note ?? '')); show(result); if (result.success) form.reset(); });
    }}>
      <label className="fd-field wide" htmlFor="context-note">Add a note<textarea id="context-note" name="note" maxLength={1000} rows={3} required placeholder="For example: I prefer simple meal plans and have 30 minutes for exercise." /></label>
      <div className="fd-act pf-act"><button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save note'}</button></div>
    </form>
    {message && <p className={`fd-msg ${success ? 'ok' : 'bad'}`} role="status">{message}</p>}
    {notes.length ? <div className="pf-notes">
      {shown.map((item) => <article className="pf-card" key={item.id}>
        <p>{item.note}</p>
        <div>
          <small>{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(new Date(item.updatedAt))}</small>
          <button className="pf-pill alert" type="button" disabled={pending} onClick={() => startTransition(async () => show(await safeAction(deleteContextNoteAction)(item.id)))}>Delete</button>
        </div>
      </article>)}
      {hidden > 0 && <button className="fd-link pf-more" type="button" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `${hidden} more note${hidden === 1 ? '' : 's'}`}</button>}
    </div> : <p className="fd-empty pf-empty">Nothing saved yet. Add a note above when there is something you want Orbis to keep handy.</p>}
  </>;
}
