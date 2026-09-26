import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAppUnlocked } from '@/lib/security/app-lock';
import { envZerodhaCredentials, exchangeRequestToken, ZerodhaAuthError } from '@/lib/invest/zerodha';
import { saveZerodhaSession } from '@/lib/invest/zerodha-connection';

/**
 * Where Zerodha sends the user back, carrying a one-time request_token.
 *
 * This must match the redirect URL registered on the Kite app exactly. The
 * token is traded for a session immediately: it is single-use and short-lived,
 * so there is nothing to keep if the exchange fails.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const requestToken = url.searchParams.get('request_token');
  const status = url.searchParams.get('status');
  const back = (reason: string) => NextResponse.redirect(new URL(`/?tab=invest&zerodha=${reason}`, request.url));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== 'string' || !(await isAppUnlocked(data?.claims))) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // The user can decline at Zerodha, which comes back without a token.
  if (status === 'error' || !requestToken) return back('cancelled');

  const credentials = envZerodhaCredentials();
  if (!credentials) return back('not-configured');

  try {
    const session = await exchangeRequestToken(credentials, requestToken);
    await saveZerodhaSession(userId, session);
  } catch (caught) {
    return back(caught instanceof ZerodhaAuthError ? 'rejected' : 'failed');
  }
  return back('connected');
}
