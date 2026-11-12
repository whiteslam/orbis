import * as Sentry from '@sentry/nextjs';
import { SENTRY_OPTIONS } from '@/lib/observability/options';

// Browser error reporting, opt-in: with no NEXT_PUBLIC_SENTRY_DSN nothing is
// initialised and nothing is sent. Reports carry no request bodies, cookies or
// query strings (see lib/observability/scrub.ts).
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    ...SENTRY_OPTIONS,
  });
}

export const onRouterTransitionStart = dsn ? Sentry.captureRouterTransitionStart : undefined;
