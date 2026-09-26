import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAppUnlocked } from '@/lib/security/app-lock';
import { envZerodhaCredentials, zerodhaLoginUrl } from '@/lib/invest/zerodha';

/**
 * Sends the user to Zerodha to authorise Orbis.
 *
 * Kite has no way to mint a session without this round trip, and the session it
 * returns lasts until the next morning, so this route is walked most days
 * rather than once.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || typeof data?.claims?.sub !== 'string' || !(await isAppUnlocked(data?.claims))) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const credentials = envZerodhaCredentials();
  if (!credentials) return NextResponse.redirect(new URL('/?tab=invest&zerodha=not-configured', request.url));
  return NextResponse.redirect(zerodhaLoginUrl(credentials.apiKey));
}
