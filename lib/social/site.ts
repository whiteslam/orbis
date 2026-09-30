import type { NextRequest } from 'next/server';

/**
 * The site's own origin, for OAuth redirect URIs.
 *
 * Meta matches the redirect URI exactly against what is registered, so this has
 * to agree with the app settings character for character. NEXT_PUBLIC_SITE_URL
 * wins when set, because a request's own host is whatever proxy answered it.
 */
export function siteUrl(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  return new URL(request.url).origin;
}
