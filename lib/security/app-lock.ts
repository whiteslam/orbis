import 'server-only';

import { createHmac } from 'node:crypto';
import { cookies } from 'next/headers';
import { hasFreshAuth, signUnlockToken, verifyUnlockToken } from '@/lib/security/unlock-token';

export const APP_LOCK_IDLE_MS = 5 * 60_000;
export const APP_LOCK_MESSAGE = 'Orbis is locked. Unlock to continue.';

const COOKIE_NAME = 'orbis_unlock';
const IDLE_SECONDS = APP_LOCK_IDLE_MS / 1000;
const FRESH_AUTH_SECONDS = 60;

export type LockClaims = { sub?: unknown; session_id?: unknown; amr?: unknown };

function lockSecret() {
  const configured = process.env.APP_LOCK_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;
  // Until APP_LOCK_SECRET is set, derive a separate key from the server-only Supabase secret.
  const fallback = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!fallback) throw new Error('App lock is not configured. Add APP_LOCK_SECRET to the server environment.');
  return createHmac('sha256', fallback).update('orbis-app-lock-v1').digest('base64url');
}

const nowSec = () => Math.floor(Date.now() / 1000);

function identity(claims: LockClaims | null | undefined) {
  if (!claims || typeof claims.sub !== 'string' || typeof claims.session_id !== 'string') return null;
  return { userId: claims.sub, sessionId: claims.session_id };
}

async function writeCookie(userId: string, sessionId: string) {
  const expiresAt = nowSec() + IDLE_SECONDS;
  (await cookies()).set(COOKIE_NAME, signUnlockToken({ userId, sessionId, expiresAt }, lockSecret()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: IDLE_SECONDS,
  });
}

// True when this browser holds a valid, unexpired unlock cookie for the current user and session.
export async function isAppUnlocked(claims: LockClaims | null | undefined) {
  const who = identity(claims);
  if (!who) return false;
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  return verifyUnlockToken(token, { ...who, nowSec: nowSec() }, lockSecret()) !== null;
}

// Unlocks only when the session's JWT shows the user authenticated within the last minute.
export async function unlockWithFreshAuth(claims: LockClaims | null | undefined) {
  const who = identity(claims);
  if (!who || !hasFreshAuth(claims?.amr, nowSec(), FRESH_AUTH_SECONDS)) return false;
  await writeCookie(who.userId, who.sessionId);
  return true;
}

// Unlocks after the server itself verified a second factor for this session (the device PIN).
export async function grantAppUnlock(claims: LockClaims | null | undefined) {
  const who = identity(claims);
  if (!who) return false;
  await writeCookie(who.userId, who.sessionId);
  return true;
}

// Slides the idle window forward; never creates an unlock that did not already exist.
export async function extendAppUnlock(claims: LockClaims | null | undefined) {
  const who = identity(claims);
  if (!who || !(await isAppUnlocked(claims))) return false;
  await writeCookie(who.userId, who.sessionId);
  return true;
}

export async function clearAppUnlock() {
  (await cookies()).delete(COOKIE_NAME);
}
