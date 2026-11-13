import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAppUnlocked } from '@/lib/security/app-lock';
import { browserHost, canonicalStartUrl } from '@/lib/security/canonical-host';
import { OAUTH_STATE_MAX_AGE_SEC, signState } from '@/lib/security/oauth-state';
import { siteUrl } from '@/lib/social/site';
import { youtubeAuthUrl, youtubeConfigured, youtubeStateCookieName } from '@/lib/youtube/google';

/**
 * Sends the user to Google to let Orbis upload to their YouTube channel.
 *
 * A random state, signed and bound to this user, rides along to Google and sits
 * in a cookie; the callback refuses any return that doesn't carry both.
 */
export async function GET(request: NextRequest) {
  // Google returns to the site URL, so the session cookie has to live on that host.
  const canonical = canonicalStartUrl(request.url, siteUrl(request), browserHost(request.headers));
  if (canonical) return NextResponse.redirect(canonical);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || typeof data?.claims?.sub !== 'string' || !(await isAppUnlocked(data?.claims))) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (!youtubeConfigured()) return NextResponse.redirect(new URL('/?tab=social&social=youtube-not-configured', request.url));

  const site = siteUrl(request);
  if (!site.startsWith('https://')) {
    // Google refuses non-HTTPS redirect URIs for a web client, so say so here
    // rather than letting the round trip fail at their end.
    return NextResponse.redirect(new URL('/?tab=social&social=youtube-needs-https', request.url));
  }

  let signed: ReturnType<typeof signState>;
  try {
    signed = signState(data.claims.sub, 'youtube');
  } catch (error_) {
    console.error(error_);
    return NextResponse.redirect(new URL('/?tab=social&social=youtube-failed', request.url));
  }
  const response = NextResponse.redirect(youtubeAuthUrl(site, signed.state));
  response.cookies.set(youtubeStateCookieName, signed.cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/auth/youtube',
    maxAge: OAUTH_STATE_MAX_AGE_SEC,
  });
  return response;
}
