import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAppUnlocked } from '@/lib/security/app-lock';
import { exchangeSocialCode, SocialAuthError, type SocialPlatformId } from '@/lib/social/meta';
import { saveSocialConnection } from '@/lib/social/connections';
import { siteUrl } from '@/lib/social/site';

const isPlatform = (value: string): value is SocialPlatformId => value === 'instagram' || value === 'threads';

/**
 * Where Meta sends the user back, carrying a one-time code.
 *
 * The code is traded for a long-lived token immediately: it is single use and
 * expires in minutes, so there is nothing worth keeping if the exchange fails.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const url = new URL(request.url);
  const back = (reason: string) => NextResponse.redirect(new URL(`/?tab=social&social=${reason}`, request.url));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== 'string' || !(await isAppUnlocked(data?.claims))) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (!isPlatform(platform)) return back('unknown');

  const code = url.searchParams.get('code');
  // The user can decline at Meta, which comes back with an error and no code.
  if (!code || url.searchParams.get('error')) return back(`${platform}-cancelled`);

  try {
    const session = await exchangeSocialCode(platform, code, siteUrl(request));
    await saveSocialConnection(userId, platform, session);
  } catch (caught) {
    // Meta's own words are more useful than a generic failure here: "no Business
    // account linked" is something the user can act on.
    const message = caught instanceof SocialAuthError ? caught.message : null;
    return NextResponse.redirect(new URL(`/?tab=social&social=${platform}-failed${message ? `&why=${encodeURIComponent(message.slice(0, 160))}` : ''}`, request.url));
  }
  return back(`${platform}-connected`);
}
