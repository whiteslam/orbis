'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { requestPasswordReset, updatePassword, type AuthActionState } from '@/app/auth/actions';

const initialState: AuthActionState = { error: null, message: null };

export function PasswordResetForm({ mode }: { mode: 'request' | 'reset' }) {
  const [state, setState] = useState(initialState);
  const [isPending, startTransition] = useTransition();
  const isReset = mode === 'reset';

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = isReset
        ? await updatePassword(formData)
        : await requestPasswordReset(formData);
      setState(result);
    });
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      {!isReset ? <>
        <label htmlFor="recovery-email">Email</label>
        <input id="recovery-email" name="email" type="email" autoComplete="email" required maxLength={254} aria-invalid={Boolean(state.error)} aria-describedby={state.error || state.message ? 'recovery-feedback' : undefined} />
      </> : <>
        <label htmlFor="new-password">New password</label>
        <input id="new-password" name="password" type="password" autoComplete="new-password" required minLength={8} aria-invalid={Boolean(state.error)} aria-describedby={state.error || state.message ? 'recovery-feedback' : undefined} />
        <label htmlFor="confirm-new-password">Confirm new password</label>
        <input id="confirm-new-password" name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} aria-invalid={Boolean(state.error)} aria-describedby={state.error || state.message ? 'recovery-feedback' : undefined} />
      </>}

      {state.error && <p id="recovery-feedback" className="auth-feedback error" role="alert">{state.error}</p>}
      {state.message && <p id="recovery-feedback" className="auth-feedback success" role="status">{state.message}</p>}

      <button className="auth-submit" type="submit" disabled={isPending}>
        {isPending ? 'Please wait…' : isReset ? 'Save new password' : 'Send recovery link'}
      </button>
    </form>
  );
}
