import type { NextRequest } from 'next/server';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The site's own origin, for OAuth redirect URIs.
 *
 * Meta matches the redirect URI exactly against what is registered, so this has
 * to agree with the app settings character for character. NEXT_PUBLIC_SITE_URL
 * wins when set, because a request's own host is whatever proxy answered it.
 *
 * A deployed site is always reached over HTTPS, so a real domain written with
 * http:// (an easy slip in an environment variable) is upgraded rather than
 * taken at its word: left alone, every Meta connection stopped with "needs
 * HTTPS" on a site that was serving HTTPS all along. Only localhost stays http,
 * so a local run can still say plainly that Meta needs an HTTPS address.
 */
export function siteUrl(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  let url: URL;
  try {
    url = new URL(configured || request.url);
  } catch {
    url = new URL(request.url);
  }
  if (url.protocol === 'http:' && !LOCAL_HOSTS.has(url.hostname)) url.protocol = 'https:';
  return url.origin;
}
