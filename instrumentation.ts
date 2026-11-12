import * as Sentry from '@sentry/nextjs';
import { SENTRY_OPTIONS } from '@/lib/observability/options';

// Error reporting is opt-in: with no SENTRY_DSN nothing is initialised and nothing
// is sent. Reports carry no request bodies, cookies or query strings (see scrub.ts).
export function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    ...SENTRY_OPTIONS,
  });
}

export const onRequestError = Sentry.captureRequestError;
