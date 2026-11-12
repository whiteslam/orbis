import { SENTRY_OPTIONS } from '@/lib/observability/options';

// Browser error reporting, opt-in: with no NEXT_PUBLIC_SENTRY_DSN nothing is
// initialised, nothing is sent, and the Sentry SDK is not even downloaded. With one,
// the SDK loads in a separate chunk after the page starts, so it never sits in the
// main bundle. Reports carry no request bodies, cookies or query strings (see
// lib/observability/options.ts and scrub.ts).
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const sentry = dsn
  ? import('@sentry/nextjs').then((Sentry) => {
      Sentry.init({ dsn, ...SENTRY_OPTIONS });
      return Sentry;
    }).catch(() => null)
  : null;

// Lets Sentry time page navigations once it has loaded; a no-op until then, and always without a DSN.
export function onRouterTransitionStart(url: string, navigationType: 'push' | 'replace' | 'traverse') {
  void sentry?.then((Sentry) => Sentry?.captureRouterTransitionStart(url, navigationType));
}
