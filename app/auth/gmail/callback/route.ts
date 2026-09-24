import { NextResponse, type NextRequest } from 'next/server';
import {
  exchangeGoogleCode,
  getGoogleAccount,
  getAuthenticatedUserId,
  gmailStateCookieName,
  googleReturnCookieName,
  saveGmailConnection,
  verifySignedGmailState,
} from '@/lib/gmail/oauth';
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
  // Connections started from Profile → Settings return there; others go to Finance.
  const returnTab = request.cookies.get(googleReturnCookieName)?.value === 'settings' ? 'settings' : 'finance';
  const redirect = (status: string) => clearCookies(resultRedirect(returnTab, status));

  const stateCookie = request.cookies.get(gmailStateCookieName)?.value;
  const returnedState = request.nextUrl.searchParams.get('state');
  const stateUserId = verifySignedGmailState(stateCookie, returnedState);
  let currentUserId: string | null;
  try {
    currentUserId = await getAuthenticatedUserId();
  } catch {
    return redirect('error');
  }

  if (!stateUserId || !currentUserId || stateUserId !== currentUserId) {
    return redirect('error');
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
  } catch {
    return redirect('error');
  }
}
