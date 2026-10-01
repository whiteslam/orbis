// Every connect flow must start on the same host its callback returns to.
//
// The callback lands on whatever address is registered with the provider
// (GOOGLE_REDIRECT_URI, the Kite app's redirect URL, NEXT_PUBLIC_SITE_URL for
// Meta). The sign-in session and the signed OAuth state are cookies, and
// cookies belong to one host. Start on 127.0.0.1, a LAN address or a preview
// deployment, come back on localhost or the live domain, and the callback finds
// neither: the connection fails with nothing to say why.
//
// So a start route on the wrong host sends the user to the same route on the
// right one first. Hosts are compared, not protocols, because a proxy that
// terminates TLS can make an https visit look like http, and comparing the two
// would bounce forever. The `hop` marker caps it at one bounce regardless.
//
// Kept free of Next.js imports so it can be unit tested.

const HOP = 'hop';

/**
 * Where to send this request first, or null when it is already on the canonical host.
 *
 * `browserHost` is the Host the browser actually used (x-forwarded-host, then
 * host). It is what the cookies belong to, and Next's request.url can't be
 * trusted for it: the dev server reports localhost whatever address was typed.
 */
export function canonicalStartUrl(requestUrl: string, canonicalOrigin: string, browserHost?: string | null): string | null {
  let current: URL;
  let canonical: URL;
  try {
    current = new URL(requestUrl);
    canonical = new URL(canonicalOrigin);
    if (browserHost) current.host = browserHost.split(',')[0].trim();
  } catch {
    return null;
  }
  if (current.host === canonical.host || current.searchParams.has(HOP)) return null;
  const next = new URL(current.pathname + current.search, canonical.origin);
  next.searchParams.set(HOP, '1');
  return next.toString();
}

/** The Host a request's browser used, behind a proxy or not. */
export const browserHost = (headers: Headers) => headers.get('x-forwarded-host') ?? headers.get('host');
