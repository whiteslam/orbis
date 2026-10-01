import 'server-only';

import { after } from 'next/server';
import type { createAdminClient } from '@/lib/supabase/admin';

type Admin = ReturnType<typeof createAdminClient>;

// Postgres "undefined column" and PostgREST "column not in schema cache": a
// migration this code knows about has not been applied yet.
export const MISSING_COLUMN = new Set(['42703', 'PGRST204']);

/**
 * Bookkeeping runs after the response is sent, so a slow insert never adds to
 * what the user waits for. Outside a request (a script, a test) there is no
 * response to wait for, so it simply runs in the background.
 */
export function later(task: () => Promise<void>) {
  try {
    after(task);
  } catch {
    void task();
  }
}

/**
 * One AI attempt into ai_generation_events. `rows` is the same row from the
 * fullest to the barest, so a database that has not had the token or cost
 * migration yet still keeps the attempt with whatever it has room for.
 * Telemetry never changes what the user receives, so this never throws.
 */
export async function recordAiEvent(admin: Admin, rows: Array<Record<string, unknown>>) {
  try {
    for (const row of rows) {
      const { error } = await admin.from('ai_generation_events').insert(row);
      if (!error || !MISSING_COLUMN.has(error.code)) return;
    }
  } catch {
    // Bookkeeping only.
  }
}
