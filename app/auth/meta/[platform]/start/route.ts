import { NextResponse, type NextRequest } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/auth/session';
import { credentialEncryptionReady } from '@/lib/crypto/credentials';
import { OAUTH_STATE_MAX_AGE_SEC, signState } from '@/lib/security/oauth-state';
import { isMetaPlatform, metaCredentials, metaStateCookie, redirectUri } from '@/lib/meta/config';
import { authorizeUrl } from '@/lib/meta/requests';

/**
 * Sends the person to Instagram or Threads to let Orbis read their posts and
 * publish what they confirm. A signed state bound to this user rides along in
 * the URL and in a cookie; the callback refuses any return without both.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!isMetaPlatform(platform)) return NextResponse.redirect(new URL('/?tab=settings', request.url));
  const userId = await getAuthenticatedUserId();
  if (!userId) return NextResponse.redirect(new URL('/login', request.url));

  const credentials = metaCredentials(platform);
  if (!credentials || !credentialEncryptionReady()) return NextResponse.redirect(new URL(`/?tab=settings&meta=${platform}-not-configured`, request.url));

  const signed = signState(userId, platform);
  const response = NextResponse.redirect(authorizeUrl(platform, { clientId: credentials.clientId, redirectUri: redirectUri(platform, request.nextUrl.origin), state: signed.state }));
  response.cookies.set(metaStateCookie(platform), signed.cookieValue, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: `/auth/meta/${platform}`, maxAge: OAUTH_STATE_MAX_AGE_SEC,
  });
  return response;
}
