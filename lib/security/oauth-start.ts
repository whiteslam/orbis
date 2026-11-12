import { createHmac, timingSafeEqual } from 'node:crypto';
import { deriveSecret } from './oauth-state.ts';

// A signed note of when a "Continue with Google" flow began, kept in a short
// httpOnly cookie. The callback uses it to tell an account created by this
// flow from one that already existed (lib/security/new-account.ts). Kept free
// of Next.js imports so it can be unit tested.

export const OAUTH_START_COOKIE = 'orbis_oauth_start';
export const OAUTH_START_MAX_AGE_SEC = 10 * 60;
const VERSION = 'v1';
const PURPOSE = 'google-flow-start';

/** Distinct from the OAuth state key and every other key. */
function startSecret() {
  return deriveSecret('orbis-oauth-flow-start-v1');
}

function sign(startedAtSec: number, secret: string) {
  return createHmac('sha256', secret).update(`${VERSION}.${PURPOSE}.${startedAtSec}`).digest('base64url');
}

/** Cookie value: v1.<startedAtEpochSeconds>.<hmac>. */
export function signFlowStart(nowSec = Math.floor(Date.now() / 1000), secret = startSecret()) {
  if (!Number.isInteger(nowSec) || nowSec <= 0) throw new Error('Invalid flow start time.');
  return `${VERSION}.${nowSec}.${sign(nowSec, secret)}`;
}

/** When the flow began, or null when the cookie is missing, forged, or older than ten minutes. */
export function verifyFlowStart(cookieValue: string | undefined, nowSec = Math.floor(Date.now() / 1000), secret?: string): Date | null {
  if (!cookieValue) return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const startedAt = Number(parts[1]);
  if (!Number.isInteger(startedAt) || startedAt <= 0) return null;
  let expected: string;
  try {
    expected = sign(startedAt, secret ?? startSecret());
  } catch {
    return null;
  }
  const provided = Buffer.from(parts[2]);
  const expectedBytes = Buffer.from(expected);
  if (provided.length !== expectedBytes.length || !timingSafeEqual(provided, expectedBytes)) return null;
  if (nowSec - startedAt > OAUTH_START_MAX_AGE_SEC || startedAt - nowSec > 5) return null;
  return new Date(startedAt * 1000);
}
