import 'server-only';

import type { Session } from '@supabase/supabase-js';
import { API_OFF, TOO_LARGE, apiError, readBody } from '@/lib/api/gate';
import { NO_STORE, apiEnabled } from '@/lib/api/http';
import { anonRateKey, clientIpFrom } from '@/lib/security/anon-rate-key';
import { ACCESS_DENIED_MESSAGE, accessAllowed } from '@/lib/security/access';
import { anonRateLimitAllows } from '@/lib/security/rate-limit';

/** The tokens a caller keeps: the access token for each request, the refresh token to get the next one. */
export function tokenResponse(session: Session) {
  return Response.json({
    tokenType: 'bearer',
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? null,
  }, { headers: NO_STORE });
}

/**
 * The steps every token route takes first: the API is on, this address hasn't
 * been signing in too often, and the body is a sane size. Gives the body text,
 * or the response to send instead.
 */
export async function tokenRequest(request: Request): Promise<{ text: string } | { refuse: Response }> {
  if (!apiEnabled()) return { refuse: API_OFF() };
  if (!(await anonRateLimitAllows(anonRateKey(clientIpFrom(request.headers)), 'api_sign_in'))) {
    return { refuse: apiError(429, 'Too many sign-ins from here. Wait a few minutes, then try again.') };
  }
  const text = await readBody(request);
  return text === null ? { refuse: TOO_LARGE() } : { text };
}

/** Whether this account may hold API tokens: the same allowlist as the app's sign-in. */
export function admittedEmail(email: string | null | undefined): Response | null {
  return accessAllowed(email) ? null : apiError(403, ACCESS_DENIED_MESSAGE);
}
