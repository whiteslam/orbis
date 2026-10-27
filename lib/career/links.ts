/**
 * Links the Career screens build from stored data: apply pages, listing
 * pages, meeting links. They came from job boards, alert emails and replies,
 * so each is checked again where it is drawn, not only where it was saved.
 * Pure and client-safe.
 */

const MAX_LINK = 2048;

function parsed(value: unknown): URL | null {
  if (typeof value !== 'string' || !value || value.length > MAX_LINK) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** `value` when it is an https URL, else null: the only stored links a screen makes clickable. */
export function httpsHref(value: unknown): string | null {
  const url = parsed(value);
  return url?.protocol === 'https:' && url.hostname ? url.href : null;
}

/** The host a link points at ("meet.google.com"), shown beside it so the owner sees where it goes; null when unreadable. */
export function linkHost(value: unknown): string | null {
  const url = parsed(value);
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return null;
  return url.hostname.toLowerCase() || null;
}
