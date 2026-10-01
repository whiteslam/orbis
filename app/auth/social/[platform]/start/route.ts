import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAppUnlocked } from '@/lib/security/app-lock';
import { browserHost, canonicalStartUrl } from '@/lib/security/canonical-host';
import { metaConfigured, socialLoginUrl, type SocialPlatformId } from '@/lib/social/meta';
import { siteUrl } from '@/lib/social/site';

const isPlatform = (value: string): value is SocialPlatformId => value === 'instagram' || value === 'threads';

/** Sends the user to Meta to authorise Orbis for this platform. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  // Meta returns to the site URL, so the session cookie has to live on that host.
  const canonical = canonicalStartUrl(request.url, siteUrl(request), browserHost(request.headers));
  if (canonical) return NextResponse.redirect(canonical);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || typeof data?.claims?.sub !== 'string' || !(await isAppUnlocked(data?.claims))) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (!isPlatform(platform)) return NextResponse.redirect(new URL('/?tab=social', request.url));
  if (!metaConfigured(platform)) return NextResponse.redirect(new URL(`/?tab=social&social=${platform}-not-configured`, request.url));

  const site = siteUrl(request);
  if (!site.startsWith('https://')) {
    // Meta refuses non-HTTPS redirect URIs outright, so this is worth saying
    // rather than letting the round trip fail at their end.
    return NextResponse.redirect(new URL(`/?tab=social&social=${platform}-needs-https`, request.url));
  }
  return NextResponse.redirect(socialLoginUrl(platform, site, platform));
}
