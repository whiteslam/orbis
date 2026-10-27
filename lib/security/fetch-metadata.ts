// Whether a request was started by another site, from the browser's own
// Sec-Fetch-Site header, which a page cannot set or forge.
//
// Cookie-authenticated GET routes that spend AI credit or save what they make
// can't rely on SameSite=Lax: a top-level link from another site still carries
// the session. Those routes refuse anything that isn't this origin's own fetch
// ('same-origin') or the user typing the address or opening a bookmark ('none').
// 'same-site' is refused too, since a sibling subdomain is another app. A request
// without the header (an old browser, curl) is let through: no browser that
// would carry the cookies across sites leaves it out.
//
// Kept free of Next.js imports so it can be unit tested.

const ALLOWED = new Set(['same-origin', 'none']);

export function isCrossSiteRequest(headers: Pick<Headers, 'get'>) {
  const site = headers.get('sec-fetch-site')?.trim().toLowerCase();
  return Boolean(site) && !ALLOWED.has(site!);
}
