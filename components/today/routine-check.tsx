'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Check, LoaderCircle, Plus, SkipForward, Undo2 } from 'lucide-react';
import { answerRoutineAction } from '@/app/routines/actions';
import { clockLabel, type RoutineToday } from '@/lib/routines/types';
import { safeAction } from '@/lib/client/safe-action';

/** What the user said about the routine, in the words the settled row shows. */
function answerLabel(event: NonNullable<RoutineToday['event']>) {
  if (event.status === 'done') return 'Done';
  if (event.status === 'skipped') return 'Skipped';
  return event.note ?? 'Something else';
}

/**
 * The half of the brief that listens back.
 *
 * The note says what is due; this records what actually happened, so tomorrow's
 * note is written against a day Orbis knows rather than one it assumed. Three
 * taps cover almost everything — done, skipped, or something else with a line
 * about what you did instead — and any of them can be undone, because a mis-tap
 * should not become history.
 */
export function RoutineCheck({ current, onAnswered }: Readonly<{ current: RoutineToday; onAnswered?: () => void }>) {
  const [writingOther, setWritingOther] = useState(false);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const otherInput = useRef<HTMLInputElement>(null);
  const { routine, event } = current;

  // "Something else" swaps its button for the input, so focus follows it there rather than dropping to the page.
  useEffect(() => {
    if (writingOther) otherInput.current?.focus();
  }, [writingOther]);

  function answer(status: 'done' | 'skipped' | 'other' | null, text = '') {
    setMessage(null);
    startTransition(async () => {
      const result = await safeAction(answerRoutineAction)({ routineId: routine.id, title: routine.title, status, note: text });
      if (!result.success) {
        setMessage(result.message);
        return;
      }
      setWritingOther(false);
      setNote('');
      onAnswered?.();
    });
  }

  if (event) {
    const said = answerLabel(event);
    return (
      <div className="rt-check settled">
        <p className="rt-check-head"><span className="rt-check-tick" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>{routine.title}<b>{said}</b></p>
        <button type="button" className="fd-link" onClick={() => answer(null)} disabled={isPending}>
          <Undo2 size={12} aria-hidden="true" /> Undo
        </button>
      </div>
    );
  }

  return (
    <div className="rt-check">
      <p className="rt-check-head">{routine.title}<b>{routine.flexible ? `around ${clockLabel(routine.atTime)}` : clockLabel(routine.atTime)}</b></p>

      {writingOther ? (
        <form
          className="rt-other"
          onSubmit={(submit) => { submit.preventDefault(); if (note.trim()) answer('other', note); }}
        >
          <input
            ref={otherInput}
            value={note}
            onChange={(change) => setNote(change.currentTarget.value)}
            placeholder="Walked for 30 minutes instead"
            aria-label={`What you did instead of ${routine.title}`}
            maxLength={200}
            disabled={isPending}
          />
          <button type="submit" className="fd-button" disabled={isPending || !note.trim()}>
            {isPending ? <LoaderCircle className="workbook-spinner" size={14} /> : 'Save'}
          </button>
          <button type="button" className="fd-link" onClick={() => { setWritingOther(false); setNote(''); }} disabled={isPending}>Cancel</button>
        </form>
      ) : (
        <div className="rt-actions">
          <button type="button" onClick={() => answer('done')} disabled={isPending}><Check size={14} aria-hidden="true" /> Done</button>
          <button type="button" onClick={() => answer('skipped')} disabled={isPending}><SkipForward size={14} aria-hidden="true" /> Skipped</button>
          <button type="button" onClick={() => setWritingOther(true)} disabled={isPending}><Plus size={14} aria-hidden="true" /> Something else</button>
        </div>
      )}

      {message && <p className="fd-note">{message}</p>}
    </div>
  );
}
