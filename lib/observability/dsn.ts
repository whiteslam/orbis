// The origin a Sentry DSN reports to, e.g. https://o123.ingest.us.sentry.io, for
// the Content-Security-Policy. Null when there is no usable HTTPS DSN.
export function sentryIngestOrigin(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}
