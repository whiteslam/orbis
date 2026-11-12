import 'server-only';

import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { createAdminClient } from '@/lib/supabase/admin';
import { isMissingTable } from '@/lib/supabase/errors';
import { settingsFromRead, type PersonSettings } from './person';

const COLUMNS = 'timezone,currency,locale,modules,onboarded_at';

type ReadResult = { data: unknown; error: { code?: string } | null };

function fromRead({ data, error }: ReadResult): PersonSettings {
  if (error && !isMissingTable(error)) console.error('Could not read user_settings', error);
  return settingsFromRead(error ? null : (data as Record<string, unknown> | null), Boolean(error));
}

/** The signed-in person's settings, read through their own session. A missing table or a failed read gives the defaults, marked onboarded. */
export const getPersonSettings = cache(async (userId: string): Promise<PersonSettings> => {
  const supabase = await createClient();
  return fromRead(await supabase.from('user_settings').select(COLUMNS).eq('user_id', userId).maybeSingle());
});

/** The same, for crons running with the service role, which have no session. */
export async function getPersonSettingsAdmin(admin: ReturnType<typeof createAdminClient>, userId: string): Promise<PersonSettings> {
  return fromRead(await admin.from('user_settings').select(COLUMNS).eq('user_id', userId).maybeSingle());
}
