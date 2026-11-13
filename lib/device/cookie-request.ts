import 'server-only';

import { headers } from 'next/headers';
import { requireUser, type SignedInSession } from '@/lib/auth/session';
import { isCrossSiteRequest } from '@/lib/security/fetch-metadata';

/**
 * The checks every cookie-authenticated POST on the phone endpoints makes:
 * this site's own request (Sec-Fetch-Site, and Origin when sent), then a
 * signed-in person with Orbis unlocked. The status is 403 or 401 when refused.
 */
export async function cookieRequest(request: Request): Promise<{ session: SignedInSession; status?: undefined } | { session: null; status: 401 | 403 }> {
  const origin = request.headers.get('origin');
  if (isCrossSiteRequest(await headers()) || (origin && origin !== new URL(request.url).origin)) return { session: null, status: 403 };
  const session = await requireUser();
  return session ? { session } : { session: null, status: 401 };
}
