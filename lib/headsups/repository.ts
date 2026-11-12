import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { isHeadsupKind, parseAction, type Headsup, type HeadsupKind, type HeadsupsResponse } from '@/lib/headsups/types';

const LIST_LIMIT = 20;
// Dismissals already stored when the next one is made: the offer comes with the third.
const OFFER_OFF_AFTER = 2;
const OFFER_WINDOW_MS = 30 * 86_400_000;

/**
 * Today's heads-ups. Also creates the person's preferences row the first time,
 * which is what puts them on the daily scan. Showing a heads-up marks it seen.
 * The heads-ups themselves are read, and marked seen, under the person's own
 * session (row-level security). Only creating the preferences row uses the
 * service role: people have no insert grant on that table.
 */
export async function listHeadsups(userId: string): Promise<HeadsupsResponse> {
  const admin = createAdminClient();
  const own = await createClient();
  const empty: HeadsupsResponse = { state: 'ready', headsups: [], disabledKinds: [], offerOff: [] };
  const prefsInsert = await admin.from('headsup_preferences').upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (prefsInsert.error) {
    // The migration is not applied yet (the same codes lib/routines/repository.ts treats as a missing table). Today simply has no card.
    if (['PGRST205', 'PGRST204', '42P01'].includes(prefsInsert.error.code ?? '')) return { ...empty, state: 'setup' };
    console.error('Heads-up preferences could not be created', prefsInsert.error);
    return empty;
  }
  const now = new Date().toISOString();
  const [rows, prefs, dismissed] = await Promise.all([
    own.from('headsups').select('id,kind,urgency,title,body,action,action_label,worded_by,status,created_at').eq('user_id', userId)
      .in('status', ['new', 'seen']).or(`snoozed_until.is.null,snoozed_until.lt."${now}"`)
      .order('urgency', { ascending: false }).order('created_at', { ascending: false }).limit(LIST_LIMIT),
    own.from('headsup_preferences').select('disabled_kinds').eq('user_id', userId).maybeSingle(),
    own.from('headsups').select('kind').eq('user_id', userId).eq('status', 'dismissed').gte('updated_at', new Date(Date.now() - OFFER_WINDOW_MS).toISOString()),
  ]);
  if (rows.error) {
    console.error('Heads-ups could not be loaded', rows.error);
    return empty;
  }
  const disabledKinds = ((prefs.data?.disabled_kinds ?? []) as string[]).filter(isHeadsupKind);
  const headsups = (rows.data ?? []).flatMap((row): Headsup[] => {
    const action = parseAction(row.action);
    if (!action || !isHeadsupKind(row.kind)) return [];
    return [{ id: row.id, kind: row.kind, urgency: row.urgency, title: row.title, body: row.body, action, actionLabel: row.action_label, wordedBy: row.worded_by, createdAt: row.created_at }];
  });
  const fresh = (rows.data ?? []).filter((row) => row.status === 'new').map((row) => row.id);
  if (fresh.length) await own.from('headsups').update({ status: 'seen' }).eq('user_id', userId).in('id', fresh).eq('status', 'new');
  const counts = new Map<string, number>();
  for (const row of dismissed.data ?? []) counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1);
  const offerOff = [...counts].filter(([kind, count]) => count >= OFFER_OFF_AFTER && isHeadsupKind(kind) && !disabledKinds.includes(kind)).map(([kind]) => kind as HeadsupKind);
  return { state: 'ready', headsups, disabledKinds, offerOff };
}

/**
 * Only which checks are off, for Settings. Unlike listHeadsups it marks nothing
 * seen: opening Settings must not count as having seen a heads-up, or an urgent
 * one would never be pushed.
 */
export async function getHeadsupPrefs(userId: string): Promise<HeadsupsResponse> {
  const { data, error } = await createAdminClient().from('headsup_preferences').select('disabled_kinds').eq('user_id', userId).maybeSingle();
  if (error) return { state: ['PGRST205', 'PGRST204', '42P01'].includes(error.code ?? '') ? 'setup' : 'ready', headsups: [], disabledKinds: [], offerOff: [] };
  return { state: 'ready', headsups: [], disabledKinds: ((data?.disabled_kinds ?? []) as string[]).filter(isHeadsupKind), offerOff: [] };
}
