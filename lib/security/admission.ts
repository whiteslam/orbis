/**
 * Which accounts a service-role cron may act for.
 *
 * The allowlist (ORBIS_ALLOWED_EMAILS, lib/security/access.ts) is checked when
 * someone signs in through the app, but an account made at Supabase directly
 * can still write its own rows (a career profile, AI consent, notification
 * times) through PostgREST. A cron picks its people from those rows and runs
 * with the service role, so it asks here before doing anything for one: the
 * account's auth email must pass accessAllowed, as at sign-in.
 *
 * With no allowlist set everyone is admitted, as the app admits them, and no
 * lookups are made. An account whose lookup fails is left out.
 */
import { accessAllowed, accessRestricted } from './access.ts';

/** The one call this needs from the admin client, so tests can stand in for it. */
export type AdmissionDb = {
  auth: { admin: { getUserById(userId: string): Promise<{ data: { user: { email?: string | null } | null }; error: unknown }> } };
};

/** Lookups in flight at once: a few, so a long list doesn't fan out at GoTrue. */
const LOOKUPS_AT_ONCE = 6;

async function admitted(admin: AdmissionDb, userId: string): Promise<boolean> {
  try {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data.user) return false;
    return accessAllowed(data.user.email);
  } catch {
    return false;
  }
}

/** The ids in `userIds` whose account may use this installation. */
export async function admittedUserIds(admin: AdmissionDb, userIds: Iterable<string>): Promise<Set<string>> {
  const ids = [...new Set(userIds)];
  if (!accessRestricted()) return new Set(ids);
  const out = new Set<string>();
  let next = 0;
  const lane = async () => {
    while (next < ids.length) {
      const userId = ids[next];
      next += 1;
      if (await admitted(admin, userId)) out.add(userId); // NOSONAR: each lane looks up in turn; the lanes run side by side
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOOKUPS_AT_ONCE, ids.length) }, lane));
  return out;
}
