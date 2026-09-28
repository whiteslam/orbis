import 'server-only';

import { claimsEmail, requireUser } from '@/lib/auth/session';

/**
 * Who is asking, for Home's background reads: the signed-in user, and only
 * while the app is unlocked. Derived the same way the server actions do it,
 * never from anything the browser sends.
 */
export async function homeRequester() {
  const user = await requireUser();
  return user ? { userId: user.userId, email: claimsEmail(user.claims) } : null;
}

export const NO_STORE = { 'cache-control': 'no-store' } as const;
