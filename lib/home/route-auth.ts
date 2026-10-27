import 'server-only';

import { headers } from 'next/headers';
import { claimsEmail, requireUser } from '@/lib/auth/session';
import { isCrossSiteRequest } from '@/lib/security/fetch-metadata';

type Requester = { userId: string; email: string | null };

/**
 * Who is asking, for Home's background reads: the signed-in user, and only
 * while the app is unlocked. Derived the same way the server actions do it,
 * never from anything the browser sends.
 *
 * These are cookie-authenticated GETs, and some spend AI credit or save what
 * they make (the Home brief), so a request another site started is refused
 * with 403 before the session is even read: SameSite=Lax cookies still ride
 * along on a link from elsewhere. The app's own fetches are same-origin.
 */
export async function homeRequest(): Promise<{ requester: Requester; status?: undefined } | { requester: null; status: 401 | 403 }> {
  if (isCrossSiteRequest(await headers())) return { requester: null, status: 403 };
  const user = await requireUser();
  return user ? { requester: { userId: user.userId, email: claimsEmail(user.claims) } } : { requester: null, status: 401 };
}

/** homeRequest without the reason: null for a cross-site request or no unlocked session. */
export async function homeRequester(): Promise<Requester | null> {
  return (await homeRequest()).requester;
}

export const NO_STORE = { 'cache-control': 'no-store' } as const;
