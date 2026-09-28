// PostgREST / Postgres codes for "that table or column isn't there yet".
const MISSING_CODES = new Set(['PGRST205', 'PGRST204', '42P01']);

/** True when a Supabase error means the table or column isn't set up yet. Takes the error or its code. */
export function isMissingTable(error?: string | { code?: string } | null): boolean {
  const code = typeof error === 'string' ? error : error?.code;
  return MISSING_CODES.has(code ?? '');
}
