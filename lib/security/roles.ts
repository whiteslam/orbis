import 'server-only';

import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { createAdminClient } from '@/lib/supabase/admin';
import { isMissingTable } from '@/lib/supabase/errors';
import { parseRole, type Role } from './role';

export type { Role } from './role';
export { parseRole } from './role';

type ReadResult = { data: { role?: unknown } | null; error: { code?: string } | null };

function fromRead({ data, error }: ReadResult): Role {
  if (error) {
    if (!isMissingTable(error)) console.error('Could not read account_roles', error);
    return 'user';
  }
  return parseRole(data?.role);
}

/** The signed-in person's role, read through their own session. A missing table, row or a failed read is an ordinary user. */
export const getRole = cache(async (userId: string): Promise<Role> => {
  const supabase = await createClient();
  return fromRead(await supabase.from('account_roles').select('role').eq('user_id', userId).maybeSingle());
});

/** The same, for crons running with the service role, which have no session. */
export async function getRoleAdmin(admin: ReturnType<typeof createAdminClient>, userId: string): Promise<Role> {
  return fromRead(await admin.from('account_roles').select('role').eq('user_id', userId).maybeSingle());
}
