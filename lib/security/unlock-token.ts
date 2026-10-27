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
// Passkey sign-in has no fixed name in auth-js's AMR list, so rather than guess
// it (a wrong guess would stop passkey unlock working), that path refuses the
// second factors instead and accepts any first-factor sign-in.
const SECOND_FACTORS = ['totp', 'anonymous'] as const;

export type MethodRule = readonly string[] | { except: readonly string[] };

export const UNLOCK_METHODS = {
  // The lock screen's and the sign-in form's passkey button (confirmUnlockAction).
  passkey: { except: SECOND_FACTORS },
  // The password unlock, and signing in or up with a password.
  password: ['password'],
  // A confirmation or sign-in link opened through /auth/callback.
  emailLink: ['otp', 'magiclink', 'email/signup', 'invite'],
} as const satisfies Record<string, MethodRule>;

function methodAllowed(method: unknown, rule: MethodRule) {
  if (typeof method !== 'string') return false;
  if (Array.isArray(rule)) return rule.includes(method);
  // Every mfa/* entry is a second factor, whatever its suffix.
  return !method.startsWith('mfa/') && !(rule as { except: readonly string[] }).except.includes(method);
}

// True when the JWT's `amr` claim records an authentication within the last maxAgeSec seconds,
// by a method `methods` allows when given. Only timestamped entries count: a token refresh keeps
// the original timestamps, so it can never look fresh.
export function hasFreshAuth(amr: unknown, nowSec: number, maxAgeSec: number, methods?: MethodRule) {
  if (!Array.isArray(amr)) return false;
  return amr.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    if (methods && !methodAllowed(method, methods)) return false;
    return typeof timestamp === 'number' && timestamp <= nowSec + 5 && nowSec - timestamp <= maxAgeSec;
  });
}
