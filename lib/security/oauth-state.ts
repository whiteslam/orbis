import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Signed OAuth state, shared by the Gmail and Zerodha connect flows.
//
// The start route puts a random state in the provider's URL and a signed copy,
// bound to the signed-in user, in an httpOnly cookie. The callback accepts the
// provider's answer only when the state it carries matches the cookie, the
// signature is ours, it hasn't expired, and it was issued to the same user who
// is signed in now. That stops a forged callback from attaching someone else's
// account (login CSRF) to this user, or this user's account to someone else.
//
// Kept free of Next.js imports so it can be unit tested.

const VERSION = 'v1';
export const OAUTH_STATE_MAX_AGE_SEC = 10 * 60;
const USER_ID = /^[A-Za-z0-9-]{1,80}$/;
const PURPOSE = /^[a-z]{1,20}$/;

/** The HMAC key, derived so it never equals a key used for anything else. */
function stateSecret() {
  const lockSecret = process.env.APP_LOCK_SECRET?.trim();
  const base = lockSecret && lockSecret.length >= 32 ? lockSecret : process.env.SUPABASE_SECRET_KEY?.trim();
  if (!base) throw new Error('OAuth state signing is not configured. Set APP_LOCK_SECRET or SUPABASE_SECRET_KEY.');
  return createHmac('sha256', base).update('orbis-oauth-state-v1').digest('base64url');
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

function sign(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * A fresh state for `userId`. `state` goes in the provider URL; `cookieValue`
 * goes in an httpOnly cookie. Cookie layout: v1.<state>.<userId>.<expiresAt>.<hmac>,
 * with the purpose (gmail, zerodha) signed in but not stored.
 */
export function signState(userId: string, purpose = 'oauth', secret = stateSecret(), nowSec = nowSeconds()) {
  if (!USER_ID.test(userId) || !PURPOSE.test(purpose)) throw new Error('Invalid OAuth state input.');
  const state = randomBytes(32).toString('base64url');
  const expiresAt = nowSec + OAUTH_STATE_MAX_AGE_SEC;
  const signature = sign(`${VERSION}.${purpose}.${state}.${userId}.${expiresAt}`, secret);
  return { state, cookieValue: `${VERSION}.${state}.${userId}.${expiresAt}.${signature}` };
}

/** True only when the cookie is ours, unexpired, matches the returned state, and belongs to `userId`. */
export function verifyState(cookieValue: string | undefined, returnedState: string | null | undefined, userId: string, purpose = 'oauth', secret?: string, nowSec = nowSeconds()) {
  if (!cookieValue || !returnedState || !userId) return false;
  const parts = cookieValue.split('.');
  if (parts.length !== 5 || parts[0] !== VERSION) return false;
  const [, state, stateUser, expiresRaw, provided] = parts;
  if (!state || !provided || state !== returnedState || stateUser !== userId) return false;

  let expected: string;
  try {
    expected = sign(`${VERSION}.${purpose}.${state}.${stateUser}.${expiresRaw}`, secret ?? stateSecret());
  } catch {
    return false;
  }
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  if (providedBytes.length !== expectedBytes.length || !timingSafeEqual(providedBytes, expectedBytes)) return false;

  const expiresAt = Number(expiresRaw);
  return Number.isInteger(expiresAt) && expiresAt > nowSec;
}
