import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { isAppUnlocked } from '@/lib/security/app-lock';

/**
 * Who is asking, for Home's background reads: the signed-in user, and only
 * while the app is unlocked. Derived the same way the server actions do it,
 * never from anything the browser sends.
 */
export async function homeRequester() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== 'string') return null;
  if (!(await isAppUnlocked(data?.claims))) return null;
  const email = typeof data?.claims?.email === 'string' ? data.claims.email.toLowerCase() : null;
  return { userId, email };
}

export const NO_STORE = { 'cache-control': 'no-store' } as const;
