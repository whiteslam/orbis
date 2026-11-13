const MAX_PATH_CHARS = 2048;
const BASE = 'https://orbis.invalid';
// Control characters, the space, DEL and backslashes: the URL parser strips or rewrites them.
const UNSAFE = /[\x00-\x20\x7f\\]/;

/**
 * Where a tapped push may lead: a path on this site ("/active#money"), or null.
 * A push payload is never trusted to name another site, so an absolute URL, a
 * protocol-relative "//host", a backslash form the browser reads as one, and any
 * control character or space the URL parser would strip into one are all refused.
 */
export function safePushPath(url: unknown): string | null {
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_PATH_CHARS) return null;
  if (!url.startsWith('/') || url.startsWith('//') || UNSAFE.test(url)) return null;
  try {
    // Belt and braces: whatever the parser makes of it must still be this site.
    if (new URL(url, BASE).origin !== BASE) return null;
  } catch {
    return null;
  }
  return url;
}
