'use client';

import { useCallback, useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import Link from 'next/link';
import { UserKey } from 'lucide-react';
import { signIn, signInWithGoogle, signUp, type AuthActionState } from '@/app/auth/actions';
import { confirmUnlockAction } from '@/app/security/actions';
import { createClient } from '@/lib/supabase/client';
import { passkeyErrorMessage, supportsPasskeys } from '@/components/security/passkey-errors';
import { safeAction } from '@/lib/client/safe-action';
import { MIN_PASSWORD_LENGTH } from '@/lib/security/fresh-auth';
import { useNativeApp } from '@/components/native/use-native';

/** Google's four-colour "G"; lucide ships no brand marks. */
function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.27-2.09 3.57-5.17 3.57-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56v-3.1H1.27a12 12 0 0 0 0 10.76l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.6 4.58 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.62l4 3.1C6.22 6.88 8.87 4.77 12 4.77Z" />
    </svg>
  );
}

const initialState: AuthActionState = { error: null, message: null };

/**
 * `googleSignIn` shows the Google button, in both modes, only when the server has it switched on,
 * and never in the Android app: Google refuses to sign in inside an app's web view.
 * `signupOpen` is false while the installation is restricted to an allowlist.
 * The tab is hidden rather than disabled: offering a control that the server
 * will always refuse is worse than not offering it.
 */
export function AuthForm({ initialMessage, signupOpen = true, googleSignIn = false }: Readonly<{ initialMessage?: string; signupOpen?: boolean; googleSignIn?: boolean }>) {
  const nativeApp = useNativeApp();
  const showGoogle = googleSignIn && !nativeApp;
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [state, setState] = useState<AuthActionState>({ ...initialState, message: initialMessage ?? null });
  const [isPending, startTransition] = useTransition();
  const isSignup = mode === 'signup';
  const [canUsePasskey, setCanUsePasskey] = useState(false);
  const autofill = useRef<AbortController | null>(null);

  // After Supabase signs in with a passkey, the server confirms the fresh sign-in and unlocks Orbis.
  const finishPasskeySignIn = useCallback(async (error: unknown) => {
    if (error) {
      const message = passkeyErrorMessage(error);
      if (message) setState({ error: message, message: null });
      return;
    }
    const result = await safeAction(confirmUnlockAction)();
    if (!result.success) {
      setState({ error: result.message, message: null });
      return;
    }
    // A full load, not router.replace: the proxy is what turns '/' into the app
    // for a signed-in visitor, and it can only do that for a real navigation.
    window.location.replace('/');
  }, []);

  // Passkey support can only be read client-side; the server render assumes it is unavailable.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setCanUsePasskey(supportsPasskeys()), []);

  // Offer saved passkeys in the email field's autofill list while signing in.
  useEffect(() => {
    if (isSignup || !supportsPasskeys()) return;
    const controller = new AbortController();
    autofill.current = controller;
    void (async () => {
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

  function continueWithGoogle() {
    autofill.current?.abort();
    setState(initialState);
    startTransition(async () => {
      // On success the action redirects to Google, so only a refusal comes back.
      const result = await signInWithGoogle();
      setState(result);
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

  let submitLabel = isSignup ? 'Create account' : 'Sign in';
  if (isPending) submitLabel = 'Please wait…';

  function switchMode(nextMode: 'signin' | 'signup') {
    setMode(nextMode);
    setState(initialState);
  }

  return (
    <>
      <div className="auth-heading">
        <h1>{isSignup ? 'Create your account' : 'Welcome back'}</h1>
        <p>{isSignup ? 'Start building a clearer picture of your life.' : 'Sign in to continue to Orbis.'}</p>
      </div>

      {signupOpen && (
        <fieldset className="auth-mode" aria-label="Account access">
          <button type="button" onClick={() => switchMode('signin')} className={!isSignup ? 'active' : ''} aria-pressed={!isSignup}>Sign in</button>
          <button type="button" onClick={() => switchMode('signup')} className={isSignup ? 'active' : ''} aria-pressed={isSignup}>Create account</button>
        </fieldset>
      )}

      <form className="auth-form" onSubmit={handleSubmit}>
        <label htmlFor="auth-email">Email</label>
        <input id="auth-email" name="email" type="email" autoComplete={isSignup ? 'email' : 'username webauthn'} required maxLength={254} aria-invalid={Boolean(state.error)} aria-describedby={state.error || state.message ? 'auth-feedback' : undefined} />

        <label htmlFor="auth-password">Password</label>
        <input id="auth-password" name="password" type="password" autoComplete={isSignup ? 'new-password' : 'current-password'} required minLength={isSignup ? MIN_PASSWORD_LENGTH : 8} aria-invalid={Boolean(state.error)} aria-describedby={state.error || state.message ? 'auth-feedback' : undefined} />

        {isSignup && <>
          <label htmlFor="auth-confirm-password">Confirm password</label>
          <input id="auth-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} aria-invalid={Boolean(state.error)} aria-describedby={state.error || state.message ? 'auth-feedback' : undefined} />
        </>}

        {state.error && <p id="auth-feedback" className="auth-feedback error" role="alert">{state.error}</p>}
        {state.message && <output id="auth-feedback" className="auth-feedback success">{state.message}</output>}

        <button className="auth-submit" type="submit" disabled={isPending}>
          {submitLabel}
        </button>
      </form>

      {(showGoogle || (!isSignup && canUsePasskey)) && <div className="auth-divider"><span>or</span></div>}
      {showGoogle && (
        <button className="auth-passkey" type="button" onClick={continueWithGoogle} disabled={isPending}>
          <GoogleMark /> Continue with Google
        </button>
      )}
      {!isSignup && canUsePasskey && (
        <button className="auth-passkey" type="button" onClick={signInWithPasskey} disabled={isPending}>
          <UserKey size={17} strokeWidth={1.8} aria-hidden="true" /> Continue with a passkey
        </button>
      )}

      {!isSignup && <Link className="auth-link auth-forgot" href="/forgot-password">Forgot password?</Link>}
    </>
  );
}
