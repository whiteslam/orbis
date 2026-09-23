import { NextResponse, type NextRequest } from 'next/server';
import {
  exchangeGoogleCode,
  getGoogleAccount,
  getAuthenticatedUserId,
  gmailStateCookieName,
  saveGmailConnection,
  verifySignedGmailState,
} from '@/lib/gmail/oauth';
import { getSiteUrl } from '@/lib/site-url';

function financeRedirect(status: string) {
  return NextResponse.redirect(new URL(`/?tab=finance&gmail=${status}`, getSiteUrl()));
}

function clearStateCookie(response: NextResponse) {
  response.cookies.set(gmailStateCookieName, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/auth/gmail',
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest) {
  const stateCookie = request.cookies.get(gmailStateCookieName)?.value;
  const returnedState = request.nextUrl.searchParams.get('state');
  const stateUserId = verifySignedGmailState(stateCookie, returnedState);
  let currentUserId: string | null;
  try {
    currentUserId = await getAuthenticatedUserId();
  } catch {
    return clearStateCookie(financeRedirect('error'));
  }

  if (!stateUserId || !currentUserId || stateUserId !== currentUserId) {
    return clearStateCookie(financeRedirect('error'));
  }

  const providerError = request.nextUrl.searchParams.get('error');
  const code = request.nextUrl.searchParams.get('code');
  if (providerError || !code) {
    return clearStateCookie(financeRedirect(providerError === 'access_denied' ? 'cancelled' : 'error'));
  }

  try {
    const token = await exchangeGoogleCode(code);
    const account = await getGoogleAccount(token.access_token);
    await saveGmailConnection(currentUserId, account, token.refresh_token);
    return clearStateCookie(financeRedirect('connected'));
  } catch {
    return clearStateCookie(financeRedirect('error'));
  }
}
