import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp } from '@/lib/security/csp';
import { updateSession } from '@/lib/supabase/proxy';

// Pages a stranger is meant to read. They talk to nothing but this origin, so
// they get the quiet policy; everything else, including the sign-in pages, needs
// Supabase and gets the app's.
const PUBLIC_PAGES = new Set(['/', '/waitlist', '/privacy', '/terms', '/support', '/offline']);

export async function proxy(request: NextRequest) {
  // A fresh nonce per request. Next reads it back out of the Content-Security-Policy
  // request header during rendering and stamps it on its own scripts; the layout
  // reads x-nonce for the inline theme script.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp({
    nonce,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    isDev: process.env.NODE_ENV === 'development',
    scope: PUBLIC_PAGES.has(request.nextUrl.pathname) ? 'public' : 'app',
  });

  const { response, claims } = await updateSession(request, { 'x-nonce': nonce, 'Content-Security-Policy': csp });
  response.headers.set('Content-Security-Policy', csp);

  // Where the two doors lead. Decided here rather than in the pages so that a
  // request that has no business seeing the app is answered with a redirect
  // before anything renders: no markup, no RSC payload, nothing to read. The
  // pages still check for themselves, since the proxy only sees a valid token,
  // not whether that address is on the list.
  const { pathname, search } = request.nextUrl;
  const signedIn = Boolean(claims);
  if (pathname === '/active' || pathname.startsWith('/active/')) {
    if (!signedIn) return handOff(response, new URL('/login', request.url), csp);
  } else if (pathname === '/' && signedIn) {
    // The public waitlist is the front door for everyone else. Whoever holds a
    // session is passed through to the app, query and all, which is how a
    // home-screen icon and a tapped notification arrive without any public file
    // ever naming the route.
    return handOff(response, new URL(`/active${search}`, request.url), csp);
  }

  return response;
}

/**
 * Redirects, keeping whatever `updateSession` just set.
 *
 * Supabase may have refreshed the session on this very request; building a bare
 * redirect would drop the new cookie and sign the person out on the next hop.
 */
function handOff(from: NextResponse, to: URL, csp: string) {
  const response = NextResponse.redirect(to);
  for (const cookie of from.cookies.getAll()) response.cookies.set(cookie);
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
      // Prefetches from next/link don't render HTML, so they need neither a nonce nor a policy.
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
