import { NextResponse, type NextRequest } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/auth/session';
import { verifyState } from '@/lib/security/oauth-state';
import { envZerodhaCredentials, exchangeRequestToken, ZerodhaAuthError, zerodhaStateCookieName } from '@/lib/invest/zerodha';
import { saveZerodhaSession } from '@/lib/invest/zerodha-connection';

/**
 * Where Zerodha sends the user back, carrying a one-time request_token.
 *
 * This must match the redirect URL registered on the Kite app exactly. The
 * token is traded for a session immediately: it is single-use and short-lived,
 * so there is nothing to keep if the exchange fails.
 *
 * The request_token is only accepted when the `state` Kite echoes back (from
 * redirect_params) matches the signed cookie set by /auth/zerodha/start for this
 * same user. Without that, a crafted link could attach someone else's Zerodha
 * account to whoever clicks it.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const requestToken = url.searchParams.get('request_token');
  const status = url.searchParams.get('status');
  const back = (reason: string) => {
    const response = NextResponse.redirect(new URL(`/?tab=investments&zerodha=${reason}`, request.url));
    // The state is single-use: clear it whatever the outcome.
    response.cookies.set(zerodhaStateCookieName, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/auth/zerodha', maxAge: 0 });
    return response;
  };

  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // The user can decline at Zerodha, which comes back without a token.
  if (status === 'error' || !requestToken) return back('cancelled');

  if (!verifyState(request.cookies.get(zerodhaStateCookieName)?.value, url.searchParams.get('state'), userId, 'zerodha')) {
    return back('failed');
  }

  const credentials = envZerodhaCredentials();
  if (!credentials) return back('not-configured');

  try {
    const session = await exchangeRequestToken(credentials, requestToken);
    await saveZerodhaSession(userId, session);
  } catch (caught) {
    if (!(caught instanceof ZerodhaAuthError)) console.error(caught);
    return back(caught instanceof ZerodhaAuthError ? 'rejected' : 'failed');
  }
  return back('connected');
}
