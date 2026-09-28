import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAppUnlocked } from '@/lib/security/app-lock';
import { OAUTH_STATE_MAX_AGE_SEC, signState } from '@/lib/security/oauth-state';
import { envZerodhaCredentials, zerodhaLoginUrl, zerodhaStateCookieName } from '@/lib/invest/zerodha';

/**
 * Sends the user to Zerodha to authorise Orbis.
 *
 * Kite has no way to mint a session without this round trip, and the session it
 * returns lasts until the next morning, so this route is walked most days
 * rather than once.
 *
 * A signed state, bound to this user, rides along in Kite's redirect_params and
 * in a cookie; the callback refuses any return that doesn't carry both.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== 'string' || !(await isAppUnlocked(data?.claims))) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const credentials = envZerodhaCredentials();
  if (!credentials) return NextResponse.redirect(new URL('/?tab=invest&zerodha=not-configured', request.url));

  let signed: ReturnType<typeof signState>;
  try {
    signed = signState(userId, 'zerodha');
  } catch (caught) {
    console.error(caught);
    return NextResponse.redirect(new URL('/?tab=invest&zerodha=not-configured', request.url));
  }

  const response = NextResponse.redirect(zerodhaLoginUrl(credentials.apiKey, signed.state));
  response.cookies.set(zerodhaStateCookieName, signed.cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/auth/zerodha',
    maxAge: OAUTH_STATE_MAX_AGE_SEC,
  });
  return response;
}
