// Links this phone to the signed-in person and starts native push. Run by
// components/native/native-bridge.tsx inside the Android app only, after Orbis is
// unlocked; never call it on the web (every OrbisCore call would reject anyway).
//
// The device secret goes from the register response straight into setDevice: it is
// never kept in React state, logged, or put in a URL.

import { OrbisCore, type CoreStatus } from './orbis-core';
import { getPhoneLink, isSigningOut, registerBody, registerFailure, resetPhoneLink, setPhoneLink, shouldResetDevice } from './device-state';

const REGISTER_TIMEOUT_MS = 15_000;
// After a refused registration (409 at ten phones, 429, a network failure) or a phone
// service that couldn't be reached, a return to the app tries again only after this
// long. A fresh page load always tries.
const RETRY_AFTER_MS = 10 * 60_000;
const UNREACHABLE = 'Couldn’t reach this phone’s Orbis service. Try again.';

type Options = { resume?: boolean; again?: boolean };

let running: Promise<void> | null = null;
let lastFailureAt: number | null = null;

/** The push plugin, loaded only when needed so the web bundle never runs it at import. */
export async function pushPlugin() {
  return (await import('@capacitor/push-notifications')).PushNotifications;
}

/**
 * Brings the phone's credential in line with `userId`, then registers for push if
 * notifications are already allowed. Never rejects: a failure is recorded in the
 * phone-link state (lib/native/device-state.ts). Does nothing while signing out.
 *
 * One run at a time. A plain call while one is running shares it; a call with
 * `again` runs once more after it, so the person's "add this phone again" is never lost.
 *
 * - `resume`: a return to the app. Skips registering for a while after a failure.
 * - `again`: the person asked to add this phone after it was removed from the web.
 */
export function linkThisPhone(userId: string, options: Options = {}): Promise<void> {
  if (running) {
    if (!options.again) return running;
    return running.then(() => linkThisPhone(userId, options));
  }
  const current = run(userId, options).finally(() => { if (running === current) running = null; });
  running = current;
  return current;
}

async function run(userId: string, { resume = false, again = false }: Options): Promise<void> {
  if (isSigningOut()) return;
  let status: CoreStatus;
  try {
    status = await OrbisCore.status();
    const step = shouldResetDevice(status, userId);

    // Removed from another device: the phone signed itself out. Adding it back is the
    // person's call (Settings), not something a page load does behind their back.
    const removed = step === 'register' && status.signedOutReason === 'revoked' && !again;
    setPhoneLink({ removed });

    // The phone answered and already belongs to this person: nothing is failing any
    // more, so the backoff ends, and an earlier "couldn't reach" (status 0) is out of date.
    if (step === 'none') {
      lastFailureAt = null;
      if (getPhoneLink().registerError?.status === 0) setPhoneLink({ registerError: null });
    }

    const waiting = resume && lastFailureAt !== null && Date.now() - lastFailureAt < RETRY_AFTER_MS;
    // Checked again here: a sign-out may have started while status() was answering.
    if (step !== 'none' && !removed && !waiting && !isSigningOut()) {
      if (step === 'reset-then-register') {
        // Another account's credential (or one with no account): wipe and revoke it first.
        // The wipe drops the push token too, so the old push state goes with it.
        resetPhoneLink();
        await OrbisCore.signOut({ revoke: true });
      }
      await register(status, userId);
    }
  } catch {
    // status() or the reset's signOut rejected (e.g. store_unavailable): settle, don't hang.
    lastFailureAt = Date.now();
    const { push } = getPhoneLink();
    setPhoneLink({ registerError: { status: 0, message: UNREACHABLE }, push: push === 'unknown' ? 'failed' : push });
    return;
  }

  // After the credential, since a wipe clears the push token.
  try {
    await startPush(status);
  } catch {
    setPhoneLink({ push: 'failed' });
  }
}

async function register(status: CoreStatus, userId: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/device/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(registerBody(status)),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(REGISTER_TIMEOUT_MS),
    });
  } catch {
    return refused(0, null);
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.status !== 201) return refused(response.status, body);

  const { deviceId, secret } = (body ?? {}) as { deviceId?: unknown; secret?: unknown };
  if (typeof deviceId !== 'string' || typeof secret !== 'string') return refused(response.status, null);
  try {
    await OrbisCore.setDevice({ deviceId, secret, userId });
  } catch {
    return refused(response.status, null);
  }
  lastFailureAt = null;
  // A new credential: push is asked for again below (register() answers with the current token).
  resetPhoneLink();
}

function refused(status: number, body: unknown): void {
  lastFailureAt = Date.now();
  setPhoneLink({ registerError: registerFailure(status, body) });
}

/**
 * Asks Firebase for a token when notifications are allowed and push isn't already
 * registered for the current credential; the token arrives through NativeBridge's
 * 'registration' listener. Never called in a build without Firebase: the plugin's
 * register() would crash the app there.
 */
async function startPush(status: CoreStatus): Promise<void> {
  if (!status.pushReady) return setPhoneLink({ push: 'missing' });
  if (getPhoneLink().push === 'registered') return;
  const plugin = await pushPlugin();
  const { receive } = await plugin.checkPermissions();
  if (receive === 'granted') await plugin.register();
}
