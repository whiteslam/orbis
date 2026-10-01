import { NextResponse, type NextRequest } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/auth/session';
import { buildGoogleAuthorizationUrl, createSignedGmailState, gmailStateCookieName, googleReturnCookieName } from '@/lib/gmail/oauth';
import { getGmailConfig } from '@/lib/gmail/config';
import { browserHost, canonicalStartUrl } from '@/lib/security/canonical-host';
import { getSiteUrl } from '@/lib/site-url';

export async function GET(request: NextRequest) {
  // Start where Google will send the user back, or the callback can't see the session or the state.
  let redirectUri: string;
  try {
    redirectUri = getGmailConfig().redirectUri;
  } catch (error) {
    console.error('Starting the Gmail connection failed', error);
    return NextResponse.redirect(new URL('/?tab=today&gmail=setup-error', getSiteUrl()));
  }
  const canonical = canonicalStartUrl(request.url, new URL(redirectUri).origin, browserHost(request.headers));
  if (canonical) return NextResponse.redirect(canonical);

  const userId = await getAuthenticatedUserId();
  // '/' is the public landing page for signed-out visitors, so send them straight to sign-in.
  if (!userId) return NextResponse.redirect(new URL('/login', getSiteUrl()));

  try {
    const { state, cookieValue } = createSignedGmailState(userId);
    const response = NextResponse.redirect(buildGoogleAuthorizationUrl(state));
    response.cookies.set(gmailStateCookieName, cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/auth/gmail',
      maxAge: 10 * 60,
    });
    // /auth/gmail/start?return=settings brings the user back to Settings → Connections.
    if (request.nextUrl.searchParams.get('return') === 'settings') {
      response.cookies.set(googleReturnCookieName, 'settings', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/auth/gmail', maxAge: 10 * 60 });
    }
    return response;
  } catch (error) {
    console.error('Starting the Gmail connection failed', error);
    return NextResponse.redirect(new URL('/?tab=today&gmail=setup-error', getSiteUrl()));
  }
}
