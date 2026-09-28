// Shared identity for the public site: the name, canonical URL and support
// contact used by metadata, the legal pages, robots.txt and the sitemap.

export const SITE_NAME = 'Orbis';

// The date the legal pages were last reviewed. Bump it whenever their text changes.
export const LEGAL_UPDATED = '2026-09-28';

const FALLBACK_SITE_URL = 'https://orbis-starter.vercel.app';

// The canonical origin, with no trailing slash, so callers can always append a path directly.
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) return FALLBACK_SITE_URL;
  return configured.replace(/\/+$/, '');
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// null until a support address is configured, so callers can fall back to "through the support page".
export function supportEmail(): string | null {
  const configured = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim();
  if (!configured || !EMAIL_PATTERN.test(configured)) return null;
  return configured;
}
