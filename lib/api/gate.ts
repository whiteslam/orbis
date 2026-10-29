import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { runAsApiCaller, type ApiCaller } from '@/lib/api/context';
import { MAX_BODY_BYTES, NO_STORE, apiEnabled, bearerToken } from '@/lib/api/http';
import { claimsEmail } from '@/lib/auth/session';
import { ACCESS_DENIED_MESSAGE, accessAllowed } from '@/lib/security/access';

export const API_OFF = () => Response.json({ error: 'Not found.' }, { status: 404, headers: NO_STORE });

export const apiError = (status: number, error: string) => Response.json({ error }, { status, headers: NO_STORE });

/** The request body as text, or null when it is over MAX_BODY_BYTES. */
export async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return null;
  const text = await request.text();
  return new TextEncoder().encode(text).length > MAX_BODY_BYTES ? null : text;
}

export const TOO_LARGE = () => apiError(413, `Keep the body under ${MAX_BODY_BYTES / 1024} KB.`);

/** A Supabase client that holds no session and writes no cookies: for checking a token, or signing in. */
export function sessionlessClient() {
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: { getAll: () => [], setAll: () => {} },
  });
}

/**
 * The one way into /api/v1 for a signed-in caller.
 *
 * The person comes from the bearer token's verified claims, never from
 * anything else in the request, and must pass the same allowlist as the app's
 * sign-in. Cookies are ignored: a browser on another site can't make a call
 * here count as the user, because it can't add the header. The handler then
 * runs as that caller (lib/api/context.ts), so the app's own server code works
 * unchanged under the caller's row-level security.
 */
export async function asApiCaller(request: Request, handle: (caller: ApiCaller & { userId: string; email: string | null }) => Promise<Response>): Promise<Response> {
  if (!apiEnabled()) return API_OFF();
  const accessToken = bearerToken(request.headers.get('authorization'));
  if (!accessToken) return apiError(401, 'Send your access token as "Authorization: Bearer <token>". Get one from POST /api/v1/auth/token.');

  const { data, error } = await sessionlessClient().auth.getClaims(accessToken);
  const claims = data?.claims;
  if (error || !claims || typeof claims.sub !== 'string' || claims.role !== 'authenticated') {
    return apiError(401, 'That access token is invalid or has expired. Refresh it with POST /api/v1/auth/refresh.');
  }
  const email = claimsEmail(claims);
  if (!accessAllowed(email)) return apiError(403, ACCESS_DENIED_MESSAGE);

  const caller = { accessToken, claims };
  try {
    return await runAsApiCaller(caller, () => handle({ ...caller, userId: claims.sub, email }));
  } catch (thrown) {
    console.error('api/v1 request failed', thrown);
    return apiError(500, 'Something went wrong on our side. Try again in a little while.');
  }
}
