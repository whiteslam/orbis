import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Refreshes the Supabase session cookie. `forwardHeaders` are added to the request
// headers that reach the rendering server (the CSP nonce travels this way). They are
// merged into a fresh copy each time a response is built so a refreshed cookie header
// is never lost.
export async function updateSession(request: NextRequest, forwardHeaders: Record<string, string> = {}) {
  const next = () => {
    const headers = new Headers(request.headers);
    Object.entries(forwardHeaders).forEach(([name, value]) => headers.set(name, value));
    return NextResponse.next({ request: { headers } });
  };

  let response = next();
  const pendingCookies = new Map<string, { name: string; value: string; options?: CookieOptions }>();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          cookiesToSet.forEach((cookie) => pendingCookies.set(cookie.name, cookie));

          response = next();
          pendingCookies.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  await supabase.auth.getClaims();
  return response;
}
