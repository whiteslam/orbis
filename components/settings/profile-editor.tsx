'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deletePersonalProfileAction, savePersonalProfileAction } from '@/app/personal/actions';
import type { PersonalDataState, PersonalProfile } from '@/lib/personal/repository';
import { safeAction } from '@/lib/client/safe-action';

const EMPTY_PROFILE: PersonalProfile = { preferredName: '', role: '', aboutMe: '' };

const NOTICE: Partial<Record<PersonalDataState, string>> = {
  setup: 'Your profile can’t be saved right now. Try again later.',
  unavailable: 'Your profile could not be loaded. Refresh and try again.',
};

export function ProfileEditor({ state, profile }: Readonly<{ state: PersonalDataState; profile: PersonalProfile | null }>) {
  const router = useRouter();
  const [draft, setDraft] = useState(profile ?? EMPTY_PROFILE);
  // Saved details read as text, like a journal entry does. The form is a mode
  // you enter, not the resting state of your own profile.
  const [editing, setEditing] = useState(!profile);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Keeps the draft in step with the saved profile after a save or reload.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(profile ?? EMPTY_PROFILE);
  }, [profile]);

  function show(result: { success: boolean; message: string }) {
    setMessage(result.message);
    setSuccess(result.success);
    if (result.success) {
      setEditing(false);
      router.refresh();
    }
  }

  const blocked = pending || state !== 'ready';
  const notice = NOTICE[state] ?? null;

  if (profile && !editing) {
    return <section aria-label="Your personal profile">
      {notice && <output className="fd-msg bad">{notice}</output>}
      <dl className="fd-pairs">
        <div><dt>Name</dt><dd>{profile.preferredName.trim() || 'Not set'}</dd></div>
        <div><dt>Work or role</dt><dd>{profile.role.trim() || 'Not set'}</dd></div>
      </dl>
      {profile.aboutMe.trim()
        ? <p className="fd-prose">{profile.aboutMe.trim()}</p>
        : <p className="fd-note">Nothing written under “more about me” yet. That is the part Orbis leans on most.</p>}
      <div className="fd-act pf-act">
        <button type="button" onClick={() => setEditing(true)}>Edit</button>
        <button className="fd-link alert" type="button" disabled={blocked} onClick={() => startTransition(async () => show(await safeAction(deletePersonalProfileAction)()))}>{pending ? 'Removing…' : 'Remove'}</button>
      </div>
      {message && <output className={`fd-msg ${success ? 'ok' : 'bad'}`}>{message}</output>}
    </section>;
  }

  let submitLabel = profile ? 'Save changes' : 'Save profile';
  if (pending) submitLabel = 'Saving…';

  return <section aria-label="Your personal profile">
    {notice && <output className="fd-msg bad">{notice}</output>}
    <form className="fd-form" onSubmit={(event) => {
      event.preventDefault();
      startTransition(async () => show(await safeAction(savePersonalProfileAction)(draft)));
    }}>
      <label className="fd-field wide" htmlFor="profile-name">Name to use<input id="profile-name" autoComplete="name" maxLength={80} value={draft.preferredName} onChange={(event) => setDraft({ ...draft, preferredName: event.currentTarget.value })} disabled={blocked} placeholder="Your preferred name" /></label>
      <label className="fd-field wide" htmlFor="profile-role">Work or role<input id="profile-role" maxLength={120} value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.currentTarget.value })} disabled={blocked} placeholder="For example: student, designer, business owner" /></label>
      <label className="fd-field wide" htmlFor="profile-about">More about me<textarea id="profile-about" maxLength={3000} rows={7} value={draft.aboutMe} onChange={(event) => setDraft({ ...draft, aboutMe: event.currentTarget.value })} disabled={blocked} placeholder="Share your priorities, interests, routines, preferences, and anything else you want Orbis to consider." /></label>
      <p className="fd-count">{draft.aboutMe.length.toLocaleString('en-IN')} / 3,000 · avoid passwords or other secrets</p>
      <div className="fd-act">
        <button type="submit" disabled={blocked}>{submitLabel}</button>
        {profile && <button className="ghost" type="button" disabled={pending} onClick={() => { setDraft(profile); setEditing(false); setMessage(''); }}>Cancel</button>}
      </div>
    </form>
    {message && <output className={`fd-msg ${success ? 'ok' : 'bad'}`}>{message}</output>}
  </section>;
}
