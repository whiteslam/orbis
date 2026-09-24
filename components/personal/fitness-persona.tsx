'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteFitnessPersonaAction, saveFitnessPersonaAction } from '@/app/personal/actions';
import { FITNESS_PERSONA_STARTER } from '@/lib/personal/fitness-persona';
import type { FitnessPersonaState } from '@/lib/personal/repository';
import { safeAction } from '@/lib/client/safe-action';

export function FitnessPersonaEditor({ state, persona }: { state: FitnessPersonaState; persona: string | null }) {
  const router = useRouter();
  const [draft, setDraft] = useState(persona ?? FITNESS_PERSONA_STARTER);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setDraft(persona ?? FITNESS_PERSONA_STARTER);
  }, [persona]);

  function show(result: { success: boolean; message: string }) {
    setMessage(result.message);
    setSuccess(result.success);
    if (result.success) router.refresh();
  }

  return <section aria-labelledby="fitness-persona-title">
    <div className="memory-info">
      <strong id="fitness-persona-title">Your fitness coaching persona</strong>
      <p>Orbis can use this as coaching preferences. It is saved to your account and is only sent with a health or fitness workbook when you select it for that request.</p>
      <p>The starter draft comes from your 2021 plan. It treats old measurements and targets as historical, not current.</p>
    </div>
    {state === 'setup' && <p className="finance-notice error" role="status">Apply `202609240008_fitness_persona.sql` in Supabase to save this persona.</p>}
    {state === 'unavailable' && <p className="finance-notice error" role="status">Your saved persona could not be loaded. Refresh and try again.</p>}
    <form className="personal-form stack-card" onSubmit={(event) => {
      event.preventDefault();
      startTransition(async () => show(await safeAction(saveFitnessPersonaAction)(draft)));
    }}>
      <label htmlFor="fitness-persona">Review and edit your persona<textarea id="fitness-persona" value={draft} maxLength={3000} rows={14} onChange={(event) => setDraft(event.currentTarget.value)} disabled={pending || state !== 'ready'} required /></label>
      <small>{draft.length.toLocaleString('en-IN')} / 3,000 characters</small>
      <button className="finance-button primary" type="submit" disabled={pending || state !== 'ready'}>{pending ? 'Saving…' : persona ? 'Update persona' : 'Save persona'}</button>
    </form>
    {persona && state === 'ready' && <button className="finance-button secondary" type="button" disabled={pending} onClick={() => startTransition(async () => show(await safeAction(deleteFitnessPersonaAction)()))}>Remove saved persona</button>}
    {message && <p className={`finance-notice ${success ? 'success' : 'error'}`} role="status">{message}</p>}
  </section>;
}
