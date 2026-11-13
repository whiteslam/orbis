// How the page links this phone to the signed-in person (components/native/native-bridge.tsx),
// and what it learned on the way, kept where other screens can read it.
//
// Pure and client-safe: no Capacitor import at run time, so it is unit-tested in Node.

import type { CoreStatus } from './orbis-core';

/**
 * What the page does with the phone's credential for the person signed in:
 * - `register`: the phone has none, so ask the server for one;
 * - `none`: it already belongs to this person;
 * - `reset-then-register`: it belongs to someone else (or to nobody known), so it is
 *   wiped and revoked first. Another account's items must never sync under this one.
 */
export function shouldResetDevice(status: Pick<CoreStatus, 'registered' | 'userId'>, signedInUserId: string): 'register' | 'reset-then-register' | 'none' {
  if (!status.registered) return 'register';
  return status.userId === signedInUserId ? 'none' : 'reset-then-register';
}

const MAX_NAME_CHARS = 60;

/** The body POSTed to /api/device/register: the phone's model as its name, the build's flavour and version. */
export function registerBody(status: Pick<CoreStatus, 'model' | 'distribution' | 'appVersion'>): { name: string; flavour: 'play' | 'direct'; appVersion: string } {
  let name = status.model.trim().slice(0, MAX_NAME_CHARS);
  // Never leave half a surrogate pair at the cut; the server refuses lone halves.
  if (/[\uD800-\uDBFF]$/.test(name)) name = name.slice(0, -1);
  name = name.trimEnd() || 'Android phone';
  return { name, flavour: status.distribution, appVersion: status.appVersion };
}

export type RegisterError = { status: number; message: string };

const MAX_MESSAGE_CHARS = 300;
const COULD_NOT_ADD = 'Your phone couldn’t be added. Try again in a little while.';

/**
 * A refused registration, in words a person can read: the server's own `error`
 * text when it sent one (409 "You have 10 phones signed in…", 429), else a plain one.
 * `status` 0 means the request never got an answer.
 */
export function registerFailure(status: number, body: unknown): RegisterError {
  const error = body !== null && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
  const message = typeof error === 'string' && error.trim() ? error.trim().slice(0, MAX_MESSAGE_CHARS) : COULD_NOT_ADD;
  return { status, message };
}

/**
 * What the page knows about this phone's link, for the settings screens (Task 13's
 * privacy center reads `registerError`, e.g. the 409 at ten phones):
 * - `registerError`: the last refused registration, cleared when one succeeds;
 * - `removed`: the phone was removed from another device and signed itself out, so it
 *   is not added back on its own; linkThisPhone(userId, { again: true }) adds it back;
 * - `push`: 'unknown' until checked, 'missing' when this build has no Firebase
 *   ("Push isn't set up in this build yet."), 'failed' when Firebase could not
 *   give a token, 'registered' once a token was handed to the phone.
 */
export type PhoneLink = {
  registerError: RegisterError | null;
  removed: boolean;
  push: 'unknown' | 'missing' | 'failed' | 'registered';
};

let current: PhoneLink = { registerError: null, removed: false, push: 'unknown' };
const listeners = new Set<() => void>();

/** The current state; the same object until it changes (for useSyncExternalStore). */
export function getPhoneLink(): PhoneLink {
  return current;
}

/** Merges `patch` in; listeners hear of it only when something actually changed. */
export function setPhoneLink(patch: Partial<PhoneLink>): void {
  const next = { ...current, ...patch };
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  listeners.forEach((listener) => listener());
}

/** Calls `listener` on every change; returns the way to stop. */
export function subscribePhoneLink(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Forgets what the page knew about the old credential. Called whenever the phone's
 * credential is wiped or replaced (a reset, a new registration, sign-out): the wipe
 * also drops the push token, so push must be asked for again.
 */
export function resetPhoneLink(): void {
  setPhoneLink({ registerError: null, removed: false, push: 'unknown' });
}

let signingOut = false;

/**
 * Set by the sign-out button before the phone signs out, so a return to the app in
 * those seconds can't register the phone again while the session cookie still works.
 * Cleared when a signed-in page mounts again, or when the server sign-out didn't happen.
 */
export function setSigningOut(on: boolean): void {
  signingOut = on;
}

export function isSigningOut(): boolean {
  return signingOut;
}
