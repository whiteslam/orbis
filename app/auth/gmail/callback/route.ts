import { NextResponse, type NextRequest } from 'next/server';
import {
  exchangeGoogleCode,
  getGoogleAccount,
  GoogleOAuthError,
  gmailStateCookieName,
  googleReturnCookieName,
  saveGmailConnection,
  verifySignedGmailState,
} from '@/lib/gmail/oauth';
import { getAuthenticatedUserId } from '@/lib/auth/session';
import { getSiteUrl } from '@/lib/site-url';

function resultRedirect(returnTab: string, status: string) {
  return NextResponse.redirect(new URL(`/?tab=${returnTab}&gmail=${status}`, getSiteUrl()));
}

function clearCookies(response: NextResponse) {
  const options = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/auth/gmail', maxAge: 0 };
  response.cookies.set(gmailStateCookieName, '', options);
  response.cookies.set(googleReturnCookieName, '', options);
  return response;
}

export async function GET(request: NextRequest) {
  // Connections started from Settings return there; others go to Today, where the mail is.
  const returnTab = request.cookies.get(googleReturnCookieName)?.value === 'settings' ? 'settings' : 'today';
  const redirect = (status: string) => clearCookies(resultRedirect(returnTab, status));

  const stateCookie = request.cookies.get(gmailStateCookieName)?.value;
  const returnedState = request.nextUrl.searchParams.get('state');
  let currentUserId: string | null;
  try {
    currentUserId = await getAuthenticatedUserId();
  } catch {
    return redirect('error');
  }

  // Signed out here, a missing cookie or a stale state all mean this round trip
  // can't be trusted: more than ten minutes passed, or it started on another
  // address or in another browser. Starting again fixes each of them.
  if (!currentUserId || !verifySignedGmailState(stateCookie, returnedState, currentUserId)) {
    console.error('Gmail callback rejected', { signedIn: Boolean(currentUserId), stateCookie: Boolean(stateCookie), returnedState: Boolean(returnedState) });
    return redirect('expired');
  }

  const providerError = request.nextUrl.searchParams.get('error');
  const code = request.nextUrl.searchParams.get('code');
  if (providerError || !code) {
    return redirect(providerError === 'access_denied' ? 'cancelled' : 'error');
  }

  try {
    const token = await exchangeGoogleCode(code);
    const account = await getGoogleAccount(token.access_token);
    await saveGmailConnection(currentUserId, account, token.refresh_token, (token.scope ?? '').split(/\s+/).filter(Boolean));
    return redirect('connected');
  } catch (error) {
    console.error('Finishing the Gmail connection failed', error);
    // invalid_grant here means the one-time code was already used or went stale.
    return redirect(error instanceof GoogleOAuthError && error.reconnectRequired ? 'expired' : 'error');
  }
}
