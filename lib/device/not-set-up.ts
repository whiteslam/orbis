// The phone tables (devices, device_sources, signals, activity_ledger) arrive with
// supabase/migrations/202611120004_devices.sql. The web can be deployed before that
// migration is applied, so a read that finds them missing means "not set up yet",
// never an error to show.

import { isMissingTable } from '@/lib/supabase/errors';

const NO_RELATION = /relation .* does not exist/i;

/** True when a Supabase error (or its code) means a phone table isn't there yet. */
export function phoneTablesMissing(error: unknown): boolean {
  if (typeof error === 'string') return isMissingTable(error);
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code === 'string' && isMissingTable(code)) return true;
  return typeof message === 'string' && NO_RELATION.test(message);
}
