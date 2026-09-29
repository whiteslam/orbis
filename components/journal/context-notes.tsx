'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addContextNoteAction, deleteContextNoteAction, loadDeletedNotesAction, loadNoteHistoryAction, updateContextNoteAction } from '@/app/personal/actions';
import { HistoryPanel } from '@/components/journal/history-panel';
import type { ContextNote } from '@/lib/memory/notes';
import { noteRevisionLine } from '@/lib/history/describe';
import { safeAction } from '@/lib/client/safe-action';

/** Notes shown before "N more notes". */
const NOTES_PREVIEW = 3;

async function loadHistory(id: string) {
  const result = await safeAction(loadNoteHistoryAction)(id);
  return {
    success: result.success,
    message: result.message,
    rows: (result.items ?? []).map((item) => ({
      id: item.id,
      createdAt: item.createdAt,
      line: noteRevisionLine(item),
      before: item.action === 'edited' ? item.previous : null,
      restore: item.action === 'edited' && item.previous ? () => safeAction(updateContextNoteAction)(id, item.previous ?? '') : undefined,
      restoreLabel: 'Restore this version',
    })),
  };
}

async function loadDeleted() {
  const result = await safeAction(loadDeletedNotesAction)();
  return {
    success: result.success,
    message: result.message,
    rows: (result.items ?? []).map((item) => ({
      id: item.id,
      createdAt: item.createdAt,
      line: (item.previous ?? '').slice(0, 90),
      before: item.previous && item.previous.length > 90 ? item.previous : null,
      restore: () => safeAction(addContextNoteAction)(item.previous ?? ''),
      restoreLabel: 'Bring back',
    })),
  };
}

export function ContextNotes({ ready, notes }: { ready: boolean; notes: ContextNote[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);

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
        {editing === item.id ? (
          <form onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => { const result = await safeAction(updateContextNoteAction)(item.id, draft); show(result); if (result.success) setEditing(null); });
          }}>
            <label className="sr-only" htmlFor={`note-${item.id}`}>Edit note</label>
            <textarea id={`note-${item.id}`} className="pf-textarea hs-note-edit" value={draft} onChange={(event) => setDraft(event.currentTarget.value)} maxLength={1000} rows={3} required disabled={pending} />
            <div>
              <button className="pf-pill primary" type="submit" disabled={pending || !draft.trim()}>{pending ? 'Saving…' : 'Save'}</button>
              <button className="pf-pill" type="button" disabled={pending} onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        ) : <>
          <p>{item.note}</p>
          <div>
            <small>{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(new Date(item.updatedAt))}</small>
            <span className="hs-links">
              <button className="pf-pill" type="button" disabled={pending} onClick={() => { setDraft(item.note); setEditing(item.id); }}>Edit</button>
              <button className="pf-pill" type="button" aria-expanded={historyId === item.id} onClick={() => setHistoryId(historyId === item.id ? null : item.id)}>History</button>
              <button className="pf-pill alert" type="button" disabled={pending} onClick={() => startTransition(async () => show(await safeAction(deleteContextNoteAction)(item.id)))}>Delete</button>
            </span>
          </div>
          {historyId === item.id && <HistoryPanel title="Changes to this note" load={() => loadHistory(item.id)} empty="No changes recorded yet." />}
        </>}
      </article>)}
      {hidden > 0 && <button className="fd-link pf-more" type="button" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `${hidden} more note${hidden === 1 ? '' : 's'}`}</button>}
    </div> : <p className="fd-empty pf-empty">Nothing saved yet. Add a note above when there is something you want Orbis to keep handy.</p>}
    <button className="fd-link pf-more" type="button" aria-expanded={showDeleted} onClick={() => setShowDeleted(!showDeleted)}>{showDeleted ? 'Hide deleted notes' : 'Deleted notes'}</button>
    {showDeleted && <HistoryPanel title="Deleted notes" load={loadDeleted} empty="Nothing deleted. Notes you delete wait here." />}
  </>;
}
