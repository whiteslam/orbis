// Links this phone to the signed-in person and starts native push. Run by
// components/native/native-bridge.tsx inside the Android app only, after Orbis is
// unlocked; never call it on the web (every OrbisCore call would reject anyway).
//
// The device secret goes from the register response straight into setDevice: it is
// never kept in React state, logged, or put in a URL.

import { OrbisCore, type CoreStatus } from './orbis-core';
import { getPhoneLink, registerBody, registerFailure, setPhoneLink, shouldResetDevice } from './device-state';

const REGISTER_TIMEOUT_MS = 15_000;
// After a refused registration (409 at ten phones, 429, a network failure) a return
// to the app tries again only after this long. A fresh page load always tries.
const RETRY_AFTER_MS = 10 * 60_000;

let running: Promise<void> | null = null;
let lastFailureAt: number | null = null;

/** The push plugin, loaded only when needed so the web bundle never runs it at import. */
export async function pushPlugin() {
  return (await import('@capacitor/push-notifications')).PushNotifications;
}

/**
 * Brings the phone's credential in line with `userId`, then registers for push if
 * notifications are already allowed. One run at a time; a second call while one
 * is running shares it.
 *
 * - `resume`: a return to the app. Skips registering for a while after a refusal.
 * - `again`: the person asked to add this phone after it was removed from the web.
 */
export function linkThisPhone(userId: string, options: { resume?: boolean; again?: boolean } = {}): Promise<void> {
  running ??= run(userId, options).finally(() => { running = null; });
  return running;
}

async function run(userId: string, { resume = false, again = false }: { resume?: boolean; again?: boolean }): Promise<void> {
  const status = await OrbisCore.status();
  const step = shouldResetDevice(status, userId);

  // Removed from another device: the phone signed itself out. Adding it back is the
  // person's call (Settings), not something a page load does behind their back.
  const removed = step === 'register' && status.signedOutReason === 'revoked' && !again;
  setPhoneLink({ removed });

  const waiting = resume && lastFailureAt !== null && Date.now() - lastFailureAt < RETRY_AFTER_MS;
  if (step !== 'none' && !removed && !waiting) {
    // Another account's credential (or one with no account): wipe and revoke it first.
    if (step === 'reset-then-register') await OrbisCore.signOut({ revoke: true });
    await register(status, userId);
  }

  // A wipe also clears the push token, so push comes after the credential.
  await startPush(status);
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
  setPhoneLink({ registerError: null, removed: false });
}

function refused(status: number, body: unknown): void {
  lastFailureAt = Date.now();
  setPhoneLink({ registerError: registerFailure(status, body) });
}

/**
 * Asks Firebase for a token when notifications are already allowed; the token
 * arrives through NativeBridge's 'registration' listener. Never called in a build
 * without Firebase: the plugin's register() would crash the app there.
 */
async function startPush(status: CoreStatus): Promise<void> {
  if (!status.pushReady) return setPhoneLink({ push: 'missing' });
  const { push } = getPhoneLink();
  if (push === 'registered') return;
  const plugin = await pushPlugin();
  const { receive } = await plugin.checkPermissions();
  if (receive === 'granted') await plugin.register();
}
