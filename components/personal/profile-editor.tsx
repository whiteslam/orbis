'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deletePersonalProfileAction, savePersonalProfileAction } from '@/app/personal/actions';
import type { PersonalDataState, PersonalProfile } from '@/lib/personal/repository';
import { safeAction } from '@/lib/client/safe-action';

const EMPTY_PROFILE: PersonalProfile = { preferredName: '', role: '', aboutMe: '' };

export function ProfileEditor({ state, profile }: { state: PersonalDataState; profile: PersonalProfile | null }) {
  const router = useRouter();
  const [draft, setDraft] = useState(profile ?? EMPTY_PROFILE);
  // Saved details read as text, like a journal entry does. The form is a mode
  // you enter, not the resting state of your own profile.
  const [editing, setEditing] = useState(!profile);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
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
  const notice = state === 'setup'
    ? 'Profile storage isn’t set up yet. Apply the pending Supabase migration (202609240009_personal_profile.sql), then refresh.'
    : state === 'unavailable' ? 'Your profile could not be loaded. Refresh and try again.' : null;

  if (profile && !editing) {
    return <section aria-label="Your personal profile">
      {notice && <p className="finance-notice error" role="status">{notice}</p>}
      <dl className="fd-pairs">
        <div><dt>Name</dt><dd>{profile.preferredName.trim() || 'Not set'}</dd></div>
        <div><dt>Work or role</dt><dd>{profile.role.trim() || 'Not set'}</dd></div>
      </dl>
      {profile.aboutMe.trim()
        ? <p className="fd-prose">{profile.aboutMe.trim()}</p>
        : <p className="fd-note">Nothing written under “more about me” yet — that is the part Orbis leans on most.</p>}
      <div className="fd-row-actions">
        <button className="finance-button primary" type="button" onClick={() => setEditing(true)}>Edit</button>
        <button className="finance-button secondary" type="button" disabled={blocked} onClick={() => startTransition(async () => show(await safeAction(deletePersonalProfileAction)()))}>Remove</button>
      </div>
      {message && <p className={`finance-notice ${success ? 'success' : 'error'}`} role="status">{message}</p>}
    </section>;
  }

  return <section aria-label="Your personal profile">
    {notice && <p className="finance-notice error" role="status">{notice}</p>}
    <form className="personal-form stack-card" onSubmit={(event) => {
      event.preventDefault();
      startTransition(async () => show(await safeAction(savePersonalProfileAction)(draft)));
    }}>
      <label htmlFor="profile-name">Name to use<input id="profile-name" autoComplete="name" maxLength={80} value={draft.preferredName} onChange={(event) => setDraft({ ...draft, preferredName: event.currentTarget.value })} disabled={blocked} placeholder="Your preferred name" /></label>
      <label htmlFor="profile-role">Work or role<input id="profile-role" maxLength={120} value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.currentTarget.value })} disabled={blocked} placeholder="For example: student, designer, business owner" /></label>
      <label htmlFor="profile-about">More about me<textarea id="profile-about" maxLength={3000} rows={7} value={draft.aboutMe} onChange={(event) => setDraft({ ...draft, aboutMe: event.currentTarget.value })} disabled={blocked} placeholder="Share your priorities, interests, routines, preferences, and anything else you want Orbis to consider." /></label>
      <small>{draft.aboutMe.length.toLocaleString('en-IN')} / 3,000 characters. Avoid passwords or other secrets.</small>
      <div className="fd-row-actions">
        <button className="finance-button primary" type="submit" disabled={blocked}>{pending ? 'Saving…' : profile ? 'Save changes' : 'Save profile'}</button>
        {profile && <button className="finance-button secondary" type="button" disabled={pending} onClick={() => { setDraft(profile); setEditing(false); setMessage(''); }}>Cancel</button>}
      </div>
    </form>
    {message && <p className={`finance-notice ${success ? 'success' : 'error'}`} role="status">{message}</p>}
  </section>;
}
