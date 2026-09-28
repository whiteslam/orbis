import 'server-only';

import { createClient as createStandaloneClient } from '@supabase/supabase-js';

/**
 * Checks an account password without touching this browser's session: a
 * separate client with no cookie storage signs in, and that throwaway session is
 * signed out again straight away.
 */
export async function passwordMatches(email: string, password: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !email || !password) return false;
  const verifier = createStandaloneClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await verifier.auth.signInWithPassword({ email, password });
  if (error || !data.session) return false;
  await verifier.auth.signOut({ scope: 'local' }).catch(() => undefined);
  return true;
}
