import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAppUnlocked } from '@/lib/security/app-lock';
import { verifyState } from '@/lib/security/oauth-state';
import { exchangeSocialCode, SocialAuthError, socialStateCookieName, type SocialPlatformId } from '@/lib/social/meta';
import { saveSocialConnection } from '@/lib/social/connections';
import { siteUrl } from '@/lib/social/site';

const isPlatform = (value: string): value is SocialPlatformId => value === 'instagram' || value === 'threads';

/**
 * Where Meta sends the user back, carrying a one-time code.
 *
 * The code is traded for a long-lived token immediately: it is single use and
 * expires in minutes, so there is nothing worth keeping if the exchange fails.
 *
 * The code is only accepted when the `state` Meta echoes back matches the signed
 * cookie set by /auth/social/<platform>/start for this same user and platform.
 * Without that, a crafted link could attach someone else's account to whoever
 * clicks it, replacing their own connection.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const url = new URL(request.url);
  // The state cookie only lives under a known platform's path, so there is nothing to clear otherwise.
  if (!isPlatform(platform)) return NextResponse.redirect(new URL('/?tab=social&social=unknown', request.url));
  const done = (response: NextResponse) => {
    // The state is single-use: clear it whatever the outcome.
    response.cookies.set(socialStateCookieName, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: `/auth/social/${platform}`, maxAge: 0 });
    return response;
  };
  const back = (reason: string) => done(NextResponse.redirect(new URL(`/?tab=social&social=${reason}`, request.url)));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== 'string' || !(await isAppUnlocked(data?.claims))) {
    return done(NextResponse.redirect(new URL('/login', request.url)));
  }

  const code = url.searchParams.get('code');
  // The user can decline at Meta, which comes back with an error and no code.
  if (!code || url.searchParams.get('error')) return back(`${platform}-cancelled`);

  // Usually more than ten minutes at Meta, a start on another address, or a link
  // that never started here at all.
  if (!verifyState(request.cookies.get(socialStateCookieName)?.value, url.searchParams.get('state'), userId, `social:${platform}`)) {
    console.error('Social callback rejected', { platform, stateCookie: request.cookies.has(socialStateCookieName), returnedState: url.searchParams.has('state') });
    return back(`${platform}-failed`);
  }

  try {
    const session = await exchangeSocialCode(platform, code, siteUrl(request));
    await saveSocialConnection(userId, platform, session);
  } catch (error_) {
    // Meta's own words are more useful than a generic failure here: "no Business
    // account linked" is something the user can act on.
    const message = error_ instanceof SocialAuthError ? error_.message : null;
    const why = message ? `&why=${encodeURIComponent(message.slice(0, 160))}` : '';
    return done(NextResponse.redirect(new URL(`/?tab=social&social=${platform}-failed${why}`, request.url)));
  }
  return back(`${platform}-connected`);
}
