import 'server-only';

import { createClient } from '@supabase/supabase-js';

/**
 * A Supabase client with the publishable key and no session of its own: no
 * cookies, nothing stored, nothing refreshed. The phone endpoints use it to
 * call the device_* functions, which check the device credential themselves
 * (role anon), so no person's session and no admin key is involved.
 */
export function createDeviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Server database access is not configured.');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
