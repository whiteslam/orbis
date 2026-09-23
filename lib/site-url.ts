import 'server-only';

export function getSiteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '');
  if (configured) {
    try {
      const url = new URL(configured);
      const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      if (url.protocol === 'https:' || (url.protocol === 'http:' && isLocalhost)) return url.origin;
    } catch {
      // Fall through to a safe environment-specific result.
    }
  }

  if (process.env.NODE_ENV !== 'production') return 'http://localhost:3000';
  throw new Error('The application URL is not configured.');
}
