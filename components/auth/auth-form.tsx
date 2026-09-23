'use client';

import { useState, useTransition, type FormEvent } from 'react';
import Link from 'next/link';
import { signIn, signUp, type AuthActionState } from '@/app/auth/actions';

const initialState: AuthActionState = { error: null, message: null };

export function AuthForm({ initialMessage }: { initialMessage?: string }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [state, setState] = useState<AuthActionState>({ ...initialState, message: initialMessage ?? null });
  const [isPending, startTransition] = useTransition();
  const isSignup = mode === 'signup';

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = isSignup ? await signUp(formData) : await signIn(formData);
      setState(result);
    });
  }

  function switchMode(nextMode: 'signin' | 'signup') {
    setMode(nextMode);
    setState(initialState);
  }

  return (
    <>
      <div className="auth-heading">
        <p className="eyebrow">YOUR PRIVATE SPACE</p>
        <h1>{isSignup ? 'Create your account' : 'Welcome back'}</h1>
        <p>{isSignup ? 'Start building a clearer picture of your life.' : 'Sign in to continue to Orbis.'}</p>
      </div>

      <div className="auth-mode" aria-label="Account access">
        <button type="button" onClick={() => switchMode('signin')} className={!isSignup ? 'active' : ''} aria-pressed={!isSignup}>Sign in</button>
        <button type="button" onClick={() => switchMode('signup')} className={isSignup ? 'active' : ''} aria-pressed={isSignup}>Create account</button>
      </div>

      <form className="auth-form" onSubmit={handleSubmit}>
        <label htmlFor="auth-email">Email</label>
        <input id="auth-email" name="email" type="email" autoComplete="email" required maxLength={254} aria-invalid={Boolean(state.error)} aria-describedby={state.error || state.message ? 'auth-feedback' : undefined} />

        <label htmlFor="auth-password">Password</label>
        <input id="auth-password" name="password" type="password" autoComplete={isSignup ? 'new-password' : 'current-password'} required minLength={8} aria-invalid={Boolean(state.error)} aria-describedby={state.error || state.message ? 'auth-feedback' : undefined} />

        {isSignup && <>
          <label htmlFor="auth-confirm-password">Confirm password</label>
          <input id="auth-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} aria-invalid={Boolean(state.error)} aria-describedby={state.error || state.message ? 'auth-feedback' : undefined} />
        </>}

        {state.error && <p id="auth-feedback" className="auth-feedback error" role="alert">{state.error}</p>}
        {state.message && <p id="auth-feedback" className="auth-feedback success" role="status">{state.message}</p>}

        <button className="auth-submit" type="submit" disabled={isPending}>
          {isPending ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'}
        </button>
      </form>

      {!isSignup && <Link className="auth-link auth-forgot" href="/forgot-password">Forgot password?</Link>}
    </>
  );
}
