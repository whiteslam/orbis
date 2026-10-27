import { createHmac, timingSafeEqual } from 'node:crypto';

// Pure helpers for the app-lock cookie. Kept free of Next.js imports so they can be unit tested with node:test.

const VERSION = 'v1';
const SEGMENT = /^[A-Za-z0-9-]{1,80}$/;

function signature(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

// Token layout: v1.<userId>.<sessionId>.<expiresAtEpochSeconds>.<hmac>
export function signUnlockToken({ userId, sessionId, expiresAt }: { userId: string; sessionId: string; expiresAt: number }, secret: string) {
  if (!SEGMENT.test(userId) || !SEGMENT.test(sessionId) || !Number.isInteger(expiresAt)) throw new Error('Invalid unlock token input.');
  const payload = `${VERSION}.${userId}.${sessionId}.${expiresAt}`;
  return `${payload}.${signature(payload, secret)}`;
}

// Returns the token's expiry when it is authentic, unexpired and bound to this user and session; otherwise null.
export function verifyUnlockToken(token: string | undefined, { userId, sessionId, nowSec }: { userId: string; sessionId: string; nowSec: number }, secret: string) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 5 || parts[0] !== VERSION) return null;
  const [, tokenUser, tokenSession, expiresRaw, provided] = parts;
  const expected = signature(parts.slice(0, 4).join('.'), secret);
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  if (providedBytes.length !== expectedBytes.length || !timingSafeEqual(providedBytes, expectedBytes)) return null;
  if (tokenUser !== userId || tokenSession !== sessionId) return null;
  const expiresAt = Number(expiresRaw);
  if (!Number.isInteger(expiresAt) || expiresAt <= nowSec) return null;
  return expiresAt;
}

// The sign-in methods each unlock path produces, so an unlock only counts the
// kind of authentication its own screen asked for. Without this, any fresh amr
// entry would do, including a TOTP or other MFA factor enrolled straight at
// Supabase from a locked session (enrolment needs only the session token).
// Passkey sign-in has no fixed name in auth-js's AMR list, so both names GoTrue
// may use are accepted; the mfa/* factors never are.
export const UNLOCK_METHODS = {
  // The lock screen's and the sign-in form's passkey button (confirmUnlockAction).
  passkey: ['passkey', 'webauthn'],
  // The password unlock, and signing in or up with a password.
  password: ['password'],
  // A confirmation or sign-in link opened through /auth/callback.
  emailLink: ['otp', 'magiclink', 'email/signup', 'invite'],
} as const satisfies Record<string, readonly string[]>;

// True when the JWT's `amr` claim records an authentication within the last maxAgeSec seconds,
// by one of `methods` when given. Only timestamped entries count: a token refresh keeps the
// original timestamps, so it can never look fresh.
export function hasFreshAuth(amr: unknown, nowSec: number, maxAgeSec: number, methods?: readonly string[]) {
  if (!Array.isArray(amr)) return false;
  return amr.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    if (methods && (typeof method !== 'string' || !methods.includes(method))) return false;
    return typeof timestamp === 'number' && timestamp <= nowSec + 5 && nowSec - timestamp <= maxAgeSec;
  });
}
