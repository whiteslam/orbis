'use client';

import { useState, useTransition } from 'react';
import { Clock, Plus, Trash2 } from 'lucide-react';
import { deleteRoutineAction, saveRoutineAction } from '@/app/routines/actions';
import { clockLabel, DAY_LABELS, ROUTINE_KINDS, type Routine, type RoutineKind, type RoutinesSummary } from '@/lib/routines/types';
import { safeAction } from '@/lib/client/safe-action';

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const blank = { title: '', kind: 'workout' as RoutineKind, atTime: '19:00', days: EVERY_DAY };

/**
 * Where the day's shape is set.
 *
 * A routine is a name, a time and the days it runs. That is deliberately all:
 * the brief needs to know when to ask about something, not to become a
 * calendar with its own opinions about your week.
 */
export function RoutineSettings({ summary }: { summary: RoutinesSummary }) {
  const [draft, setDraft] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  if (summary.state !== 'ready') {
    return <p className="fd-note">{summary.state === 'setup' ? 'Apply the routines migration in Supabase to set up your day.' : 'Your routines could not be loaded. Try again shortly.'}</p>;
  }

  function run(action: () => Promise<{ success: boolean; message: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage({ text: result.message, success: result.success });
      if (result.success) {
        setDraft(blank);
        setEditing(null);
        setOpen(false);
      }
    });
  }

  function edit(routine: Routine) {
    setDraft({ title: routine.title, kind: routine.kind, atTime: routine.atTime, days: routine.days });
    setEditing(routine.id);
    setOpen(true);
  }

  const toggleDay = (day: number) => setDraft((current) => ({
    ...current,
    days: current.days.includes(day) ? current.days.filter((item) => item !== day) : [...current.days, day].sort(),
  }));

  return (
    <div className="rt-settings">
      {summary.routines.length > 0 && (
        <div className="rt-list">
          {summary.routines.map((routine) => (
            <div className="rt-row" key={routine.id}>
              <button type="button" className="rt-row-open" onClick={() => edit(routine)}>
                <span className="fd-two">
                  {routine.title}
                  <small>{clockLabel(routine.atTime)} · {routine.days.length === 7 ? 'every day' : routine.days.map((day) => DAY_LABELS[day]).join(', ')}</small>
                </span>
              </button>
              <button
                type="button"
                className="workbook-icon-button"
                aria-label={`Remove ${routine.title}`}
                disabled={isPending}
                onClick={() => { if (window.confirm(`Remove ${routine.title}? What you already logged against it is kept.`)) run(() => safeAction(deleteRoutineAction)(routine.id)); }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      {open ? (
        <form
          className="rt-form"
          onSubmit={(submit) => { submit.preventDefault(); run(() => safeAction(saveRoutineAction)({ ...draft, id: editing ?? undefined })); }}
        >
          <label className="fd-field">Name
            <input value={draft.title} onChange={(change) => setDraft({ ...draft, title: change.currentTarget.value })} placeholder="Gym" maxLength={60} required disabled={isPending} />
          </label>
          <div className="rt-form-row">
            <label className="fd-field">Kind
              <select value={draft.kind} onChange={(change) => setDraft({ ...draft, kind: change.currentTarget.value as RoutineKind })} disabled={isPending}>
                {ROUTINE_KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
              </select>
            </label>
            <label className="fd-field">Time
              <input type="time" value={draft.atTime} onChange={(change) => setDraft({ ...draft, atTime: change.currentTarget.value })} required disabled={isPending} />
            </label>
          </div>
          <p className="fd-label">Days</p>
          <div className="rt-days" role="group" aria-label="Days this runs">
            {DAY_LABELS.map((label, day) => (
              <button
                key={label}
                type="button"
                aria-pressed={draft.days.includes(day)}
                className={draft.days.includes(day) ? 'on' : undefined}
                onClick={() => toggleDay(day)}
                disabled={isPending}
              >{label.slice(0, 1)}</button>
            ))}
          </div>
          <div className="fd-act">
            <button type="submit" disabled={isPending || !draft.title.trim() || !draft.days.length}>{editing ? 'Save changes' : 'Add routine'}</button>
            <button type="button" className="fd-link" onClick={() => { setOpen(false); setEditing(null); setDraft(blank); }} disabled={isPending}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="fd-button" onClick={() => setOpen(true)}><Plus size={14} aria-hidden="true" /> Add a routine</button>
      )}

      {!summary.routines.length && !open && (
        <p className="fd-note"><Clock size={12} aria-hidden="true" /> Add the times your day already has, like a 7 pm gym session or breakfast at 8. The brief then knows what to ask you about.</p>
      )}
      {message && <p className={`gmail-review-message ${message.success ? 'success' : ''}`} role="status">{message.text}</p>}
    </div>
  );
}
