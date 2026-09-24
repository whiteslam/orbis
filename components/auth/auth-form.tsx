'use client';

import { useCallback, useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ScanFace } from 'lucide-react';
import { signIn, signUp, type AuthActionState } from '@/app/auth/actions';
import { confirmUnlockAction } from '@/app/security/actions';
import { createClient } from '@/lib/supabase/client';
import { passkeyErrorMessage, supportsPasskeys } from '@/components/security/passkey-errors';

const initialState: AuthActionState = { error: null, message: null };

export function AuthForm({ initialMessage }: { initialMessage?: string }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [state, setState] = useState<AuthActionState>({ ...initialState, message: initialMessage ?? null });
  const [isPending, startTransition] = useTransition();
  const isSignup = mode === 'signup';
  const router = useRouter();
  const [canUsePasskey, setCanUsePasskey] = useState(false);
  const autofill = useRef<AbortController | null>(null);

  // After Supabase signs in with a passkey, the server confirms the fresh sign-in and unlocks Orbis.
  const finishPasskeySignIn = useCallback(async (error: unknown) => {
    if (error) {
      const message = passkeyErrorMessage(error);
      if (message) setState({ error: message, message: null });
      return;
    }
    const result = await confirmUnlockAction();
    if (!result.success) {
      setState({ error: result.message, message: null });
      return;
    }
    router.replace('/');
    router.refresh();
  }, [router]);

  useEffect(() => setCanUsePasskey(supportsPasskeys()), []);

  // Offer saved passkeys in the email field's autofill list while signing in.
  useEffect(() => {
    if (isSignup || !supportsPasskeys()) return;
    const controller = new AbortController();
    autofill.current = controller;
    (async () => {
      const available = await window.PublicKeyCredential.isConditionalMediationAvailable?.().catch(() => false);
      if (!available || controller.signal.aborted) return;
      const { error } = await createClient().auth.signInWithPasskey({ options: { mediation: 'conditional', signal: controller.signal } });
      // Autofill runs in the background, so its failures stay silent; the explicit button reports errors.
      if (!controller.signal.aborted && !error) await finishPasskeySignIn(null);
    })();
    return () => controller.abort();
  }, [isSignup, finishPasskeySignIn]);

  function signInWithPasskey() {
    autofill.current?.abort();
    setState(initialState);
    startTransition(async () => {
      const { error } = await createClient().auth.signInWithPasskey();
      await finishPasskeySignIn(error);
    });
  }

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
        <input id="auth-email" name="email" type="email" autoComplete={isSignup ? 'email' : 'username webauthn'} required maxLength={254} aria-invalid={Boolean(state.error)} aria-describedby={state.error || state.message ? 'auth-feedback' : undefined} />

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

      {!isSignup && canUsePasskey && <>
        <div className="auth-divider"><span>or</span></div>
        <button className="auth-passkey" type="button" onClick={signInWithPasskey} disabled={isPending}>
          <ScanFace size={17} aria-hidden="true" /> Sign in with passkey
        </button>
      </>}

      {!isSignup && <Link className="auth-link auth-forgot" href="/forgot-password">Forgot password?</Link>}
    </>
  );
}
