// Shared identity for the public site: the name, canonical URL and support
// contact used by metadata, the legal pages, robots.txt and the sitemap.

export const SITE_NAME = 'Orbis';

// The date the legal pages were last reviewed. Bump it whenever their text changes.
export const LEGAL_UPDATED = '2026-09-28';

const FALLBACK_SITE_URL = 'https://orbis-starter.vercel.app';

// `value` without any trailing slashes, scanning back from the end rather than with a backtracking regex.
export function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}

// The canonical origin, with no trailing slash, so callers can always append a path directly.
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) return FALLBACK_SITE_URL;
  return withoutTrailingSlashes(configured);
}

// name@domain.tld: no whitespace, exactly one @ with something before it, and a
// dot in the domain with something on both sides.
export function looksLikeEmail(value: string): boolean {
  if (/\s/.test(value)) return false;
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@')) return false;
  return value.slice(at + 2, -1).includes('.');
}

// null until a support address is configured, so callers can fall back to "through the support page".
export function supportEmail(): string | null {
  const configured = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim();
  if (!configured || !looksLikeEmail(configured)) return null;
  return configured;
}
