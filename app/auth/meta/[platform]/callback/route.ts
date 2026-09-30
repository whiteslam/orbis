import { NextResponse, type NextRequest } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/auth/session';
import { verifyState } from '@/lib/security/oauth-state';
import { isMetaPlatform, metaCredentials, metaStateCookie, redirectUri } from '@/lib/meta/config';
import { callMeta, MetaError } from '@/lib/meta/client';
import { saveConnection } from '@/lib/meta/connection';
import { codeExchange, longLivedExchange, me } from '@/lib/meta/requests';
import { parseLongToken, parseMe, parseShortToken, stripCode } from '@/lib/meta/tokens';

/**
 * Where Instagram or Threads sends the person back with a one-time code. The
 * code is traded for a 60-day token at once; the account id comes from /me,
 * never from the exchange response (its user_id is a number JSON can't hold).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!isMetaPlatform(platform)) return NextResponse.redirect(new URL('/?tab=settings', request.url));
  const back = (reason: string) => {
    const response = NextResponse.redirect(new URL(`/?tab=settings&meta=${platform}-${reason}`, request.url));
    response.cookies.set(metaStateCookie(platform), '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: `/auth/meta/${platform}`, maxAge: 0 });
    return response;
  };

  const userId = await getAuthenticatedUserId();
  if (!userId) return NextResponse.redirect(new URL('/login', request.url));
  const url = request.nextUrl;
  const code = url.searchParams.get('code');
  if (url.searchParams.get('error') || !code) return back('cancelled');
  if (!verifyState(request.cookies.get(metaStateCookie(platform))?.value, url.searchParams.get('state'), userId, platform)) return back('failed');
  const credentials = metaCredentials(platform);
  if (!credentials) return back('not-configured');

  try {
    const short = parseShortToken(await callMeta(codeExchange(platform, { ...credentials, redirectUri: redirectUri(platform, url.origin), code: stripCode(code) })));
    if (!short) return back('failed');
    const long = parseLongToken(await callMeta(longLivedExchange(platform, { clientSecret: credentials.clientSecret, token: short })), new Date());
    // A 1-hour token would silently stop working; refuse rather than keep it.
    if (!long) return back('failed');
    const account = parseMe(platform, await callMeta(me(platform, long.accessToken)));
    if (!account) return back('failed');
    await saveConnection(userId, platform, { ...account, accessToken: long.accessToken, expiresAt: long.expiresAt });
  } catch (caught) {
    if (!(caught instanceof MetaError)) console.error(`Connecting ${platform} failed`, caught instanceof Error ? caught.message : 'unknown');
    return back(caught instanceof MetaError && caught.kind === 'rejected' ? 'rejected' : 'failed');
  }
  return back('connected');
}
