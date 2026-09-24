import { NextResponse, type NextRequest } from 'next/server';
import { buildGoogleAuthorizationUrl, createSignedGmailState, getAuthenticatedUserId, gmailStateCookieName } from '@/lib/gmail/oauth';
import { getSiteUrl } from '@/lib/site-url';

export async function GET(request: NextRequest) {
  const userId = await getAuthenticatedUserId();
  // '/' sends signed-out users to /login and shows the lock screen when Orbis is locked.
  if (!userId) return NextResponse.redirect(new URL('/', getSiteUrl()));

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
    return response;
  } catch {
    return NextResponse.redirect(new URL('/?tab=finance&gmail=setup-error', getSiteUrl()));
  }
}
