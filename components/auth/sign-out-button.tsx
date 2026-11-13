'use client';

import { useRef, type FormEvent } from 'react';
import { LogOut } from 'lucide-react';
import { signOut } from '@/app/auth/actions';
import { isNativeApp, OrbisCore } from '@/lib/native/orbis-core';
import { resetPhoneLink, setSigningOut } from '@/lib/native/device-state';

// The phone gets this long to wipe itself and tell the server; sign-out never waits longer.
const PHONE_SIGN_OUT_MS = 6_000;
// The server sign-out navigates away (or a signed-in page mounting again clears the flag,
// see NativeBridge). Still here after this long means it didn't happen: let linking run again.
const SIGN_OUT_GIVE_UP_MS = 20_000;

/** Wipes the phone and revokes its credential; settles within PHONE_SIGN_OUT_MS whatever happens. */
function signOutPhone(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<void>((resolve) => { timer = setTimeout(resolve, PHONE_SIGN_OUT_MS); });
  const wipe = OrbisCore.signOut({ revoke: true }).catch(() => undefined);
  return Promise.race([wipe, cap]).finally(() => clearTimeout(timer));
}

// `text` renders a plain "Sign out" link-style button (lock and PIN screens) instead of the top-bar icon.
// On the web it is the plain form it always was. In the Android app the phone signs
// out first, then the same form is sent again, this time to the server.
export function SignOutButton({ variant = 'icon' }: Readonly<{ variant?: 'icon' | 'text' }>) {
  const phoneDone = useRef(false);
  const busy = useRef(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (phoneDone.current || !isNativeApp()) return;
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    // Until the server sign-out lands, a return to the app must not register the phone again.
    setSigningOut(true);
    const form = event.currentTarget;
    void signOutPhone().finally(() => {
      // The phone's credential and push token are gone; so is what the page knew about them.
      resetPhoneLink();
      phoneDone.current = true;
      form.requestSubmit();
      setTimeout(() => setSigningOut(false), SIGN_OUT_GIVE_UP_MS);
    });
  }

  return (
    <form action={signOut} onSubmit={onSubmit}>
      {variant === 'text' ? (
        <button className="auth-signout" type="submit">Sign out</button>
      ) : (
        <button className="icon-btn" type="submit" aria-label="Sign out" title="Sign out">
          <LogOut size={18} />
        </button>
      )}
    </form>
  );
}
