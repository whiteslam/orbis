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
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setDraft(profile ?? EMPTY_PROFILE);
  }, [profile]);

  function show(result: { success: boolean; message: string }) {
    setMessage(result.message);
    setSuccess(result.success);
    if (result.success) router.refresh();
  }

  return <section aria-labelledby="personal-profile-title">
    <div className="memory-info">
      <strong id="personal-profile-title">Your personal profile</strong>
      <p>Add the name you want Orbis to use, what you do, and any background or preferences that help it understand you.</p>
      <p>Your details stay private in your account. Orbis sends them to OpenRouter only when you opt in for an individual workbook request. Avoid passwords or other secrets.</p>
    </div>
    {state === 'setup' && <p className="finance-notice error" role="status">Apply `202609240009_personal_profile.sql` in Supabase to save your profile.</p>}
    {state === 'unavailable' && <p className="finance-notice error" role="status">Your profile could not be loaded. Refresh and try again.</p>}
    <form className="personal-form stack-card" onSubmit={(event) => {
      event.preventDefault();
      startTransition(async () => show(await safeAction(savePersonalProfileAction)(draft)));
    }}>
      <label htmlFor="profile-name">Name to use<input id="profile-name" autoComplete="name" maxLength={80} value={draft.preferredName} onChange={(event) => setDraft({ ...draft, preferredName: event.currentTarget.value })} disabled={pending || state !== 'ready'} placeholder="Your preferred name" /></label>
      <label htmlFor="profile-role">Work or role<input id="profile-role" maxLength={120} value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.currentTarget.value })} disabled={pending || state !== 'ready'} placeholder="For example: student, designer, business owner" /></label>
      <label htmlFor="profile-about">More about me<textarea id="profile-about" maxLength={3000} rows={7} value={draft.aboutMe} onChange={(event) => setDraft({ ...draft, aboutMe: event.currentTarget.value })} disabled={pending || state !== 'ready'} placeholder="Share your priorities, interests, routines, preferences, and anything else you want Orbis to consider." /></label>
      <small>{draft.aboutMe.length.toLocaleString('en-IN')} / 3,000 characters</small>
      <button className="finance-button primary" type="submit" disabled={pending || state !== 'ready'}>{pending ? 'Saving…' : profile ? 'Update profile' : 'Save profile'}</button>
    </form>
    {profile && state === 'ready' && <button className="finance-button secondary" type="button" disabled={pending} onClick={() => startTransition(async () => show(await safeAction(deletePersonalProfileAction)()))}>Remove profile</button>}
    {message && <p className={`finance-notice ${success ? 'success' : 'error'}`} role="status">{message}</p>}
  </section>;
}
