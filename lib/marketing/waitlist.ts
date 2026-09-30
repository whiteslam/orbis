import 'server-only';

import { unstable_cache } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * How many people have joined. The table is service-role only, so this is the
 * one way the number reaches the page: counted on the server, rendered as a
 * plain number, never queryable from the browser.
 *
 * A head-count select asks Postgres for the count and none of the rows, so no
 * address leaves the database. Null means the number could not be read, and the
 * page simply doesn't mention it rather than showing a zero it isn't sure of.
 *
 * Cached for a minute, because the front door is the page strangers hit and a
 * count that is sixty seconds stale is still true enough to print. Without this
 * every visit paid for a round trip to Postgres to render one sentence.
 */
export const waitlistCount = unstable_cache(async function waitlistCount(): Promise<number | null> {
  try {
    const { count, error } = await createAdminClient()
      .from('waitlist')
      .select('id', { count: 'exact', head: true });
    if (error) {
      console.error('waitlist count failed', error);
      return null;
    }
    return typeof count === 'number' ? count : null;
  } catch (error) {
    console.error('waitlist count failed', error);
    return null;
  }
}, ['waitlist-count'], { revalidate: 60 });
