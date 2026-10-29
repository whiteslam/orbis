import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { apiCaller } from '@/lib/api/context';

export async function createClient() {
  const caller = apiCaller();
  if (caller) return createApiClient(caller.accessToken);

  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components cannot write cookies; proxy.ts refreshes sessions.
          }
        },
      },
    },
  );
}

/**
 * The client for a /api/v1 request: no cookies, the caller's access token on
 * every query, so row-level security sees the same person it would in the app.
 * getClaims() with no argument reads the stored session, and there is none
 * here, so it is pointed at the caller's token instead.
 */
function createApiClient(accessToken: string) {
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: { getAll: () => [], setAll: () => {} },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    },
  );
  const getClaims = client.auth.getClaims.bind(client.auth);
  client.auth.getClaims = (jwt, options) => getClaims(jwt ?? accessToken, options);
  return client;
}
