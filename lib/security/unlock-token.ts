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

// True when the JWT's `amr` claim records any authentication within the last maxAgeSec seconds.
// Only timestamped entries count: a token refresh keeps the original timestamps, so it can never look fresh.
export function hasFreshAuth(amr: unknown, nowSec: number, maxAgeSec: number) {
  if (!Array.isArray(amr)) return false;
  return amr.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const timestamp = (entry as { timestamp?: unknown }).timestamp;
    return typeof timestamp === 'number' && timestamp <= nowSec + 5 && nowSec - timestamp <= maxAgeSec;
  });
}
