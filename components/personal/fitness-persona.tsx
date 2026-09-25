'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteFitnessPersonaAction, saveFitnessPersonaAction } from '@/app/personal/actions';
import { FITNESS_PERSONA_STARTER } from '@/lib/personal/fitness-persona';
import type { FitnessPersonaState } from '@/lib/personal/repository';
import { safeAction } from '@/lib/client/safe-action';

/**
 * How you want to be coached about fitness.
 *
 * This used to open as a fourteen-row textarea pre-filled with the starter
 * draft — a coaching brief mentioning a 2021 plan and a 92 kg starting weight —
 * on the profile of anyone who had never asked for coaching. Nothing said what
 * it was for, so it read as something Orbis had decided about you.
 *
 * Now it starts closed and empty. The starter is an action you take, not a
 * default you inherit, and the copy says who reads this: Health, and only when
 * you tick the box for that request.
 */
export function FitnessPersonaEditor({ state, persona }: { state: FitnessPersonaState; persona: string | null }) {
  const router = useRouter();
  const [draft, setDraft] = useState(persona ?? '');
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setDraft(persona ?? '');
  }, [persona]);

  function show(result: { success: boolean; message: string }) {
    setMessage(result.message);
    setSuccess(result.success);
    if (result.success) {
      setEditing(false);
      router.refresh();
    }
  }

  const blocked = pending || state !== 'ready';
  const notice = state === 'setup'
    ? 'Coaching style can’t be saved yet. Apply the pending Supabase migration (202609240008_fitness_persona.sql), then refresh.'
    : state === 'unavailable' ? 'Your saved coaching style could not be loaded. Refresh and try again.' : null;

  function open(seed: string) {
    setDraft(seed);
    setEditing(true);
    setMessage('');
  }

  if (!editing) {
    return <section aria-label="Your fitness coaching style">
      {notice && <p className="fd-msg bad" role="status">{notice}</p>}
      {persona ? <>
        <p className="fd-prose clamp">{persona}</p>
        <div className="fd-act pf-act">
          <button className="ghost" type="button" onClick={() => open(persona)}>Edit</button>
          <button className="fd-link alert" type="button" disabled={blocked} onClick={() => startTransition(async () => show(await safeAction(deleteFitnessPersonaAction)()))}>{pending ? 'Removing…' : 'Remove'}</button>
        </div>
      </> : <>
        <p className="fd-note-lead">Nothing set, and nothing is assumed. Health asks for this only when a workbook or plan you upload has fitness in it, and even then it is included for that one request.</p>
        <div className="fd-act pf-act">
          <button type="button" disabled={blocked} onClick={() => open('')}>Write mine</button>
          <button className="ghost" type="button" disabled={blocked} onClick={() => open(FITNESS_PERSONA_STARTER)}>Start from a draft</button>
        </div>
      </>}
      {message && <p className={`fd-msg ${success ? 'ok' : 'bad'}`} role="status">{message}</p>}
    </section>;
  }

  return <section aria-label="Your fitness coaching style">
    {notice && <p className="fd-msg bad" role="status">{notice}</p>}
    <form className="fd-form" onSubmit={(event) => {
      event.preventDefault();
      startTransition(async () => show(await safeAction(saveFitnessPersonaAction)(draft)));
    }}>
      <label className="fd-field wide" htmlFor="fitness-persona">How should Orbis coach you?<textarea id="fitness-persona" value={draft} maxLength={3000} rows={12} onChange={(event) => setDraft(event.currentTarget.value)} disabled={blocked} required placeholder="For example: be direct and nonjudgmental, give me one next step, keep meals practical, and ask before giving me numbers." /></label>
      <p className="fd-count">{draft.length.toLocaleString('en-IN')} / 3,000</p>
      <div className="fd-act">
        <button type="submit" disabled={blocked}>{pending ? 'Saving…' : persona ? 'Save changes' : 'Save coaching style'}</button>
        <button className="ghost" type="button" disabled={pending} onClick={() => { setDraft(persona ?? ''); setEditing(false); setMessage(''); }}>Cancel</button>
      </div>
    </form>
    {message && <p className={`fd-msg ${success ? 'ok' : 'bad'}`} role="status">{message}</p>}
  </section>;
}
