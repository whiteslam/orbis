import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { isHeadsupKind, parseAction, type Headsup, type HeadsupKind, type HeadsupsResponse } from '@/lib/headsups/types';

const LIST_LIMIT = 20;
const OFFER_OFF_AFTER = 3;
const OFFER_WINDOW_MS = 30 * 86_400_000;

/**
 * Today's heads-ups. Also creates the person's preferences row the first time,
 * which is what puts them on the daily scan. Showing a heads-up marks it seen.
 * Uses the admin client with an explicit user_id filter, like the other Home
 * reads that run from route handlers.
 */
export async function listHeadsups(userId: string): Promise<HeadsupsResponse> {
  const admin = createAdminClient();
  const empty: HeadsupsResponse = { state: 'ready', headsups: [], disabledKinds: [], offerOff: [] };
  const prefsInsert = await admin.from('headsup_preferences').upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (prefsInsert.error) {
    // 42P01: the migration is not applied yet. Today simply has no card.
    if (prefsInsert.error.code === '42P01') return { ...empty, state: 'setup' };
    console.error('Heads-up preferences could not be created', prefsInsert.error);
    return empty;
  }
  const now = new Date().toISOString();
  const [rows, prefs, dismissed] = await Promise.all([
    admin.from('headsups').select('id,kind,urgency,title,body,action,action_label,worded_by,status,created_at').eq('user_id', userId)
      .in('status', ['new', 'seen']).or(`snoozed_until.is.null,snoozed_until.lt."${now}"`)
      .order('urgency', { ascending: false }).order('created_at', { ascending: false }).limit(LIST_LIMIT),
    admin.from('headsup_preferences').select('disabled_kinds').eq('user_id', userId).maybeSingle(),
    admin.from('headsups').select('kind').eq('user_id', userId).eq('status', 'dismissed').gte('updated_at', new Date(Date.now() - OFFER_WINDOW_MS).toISOString()),
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
  if (fresh.length) await admin.from('headsups').update({ status: 'seen' }).eq('user_id', userId).in('id', fresh).eq('status', 'new');
  const counts = new Map<string, number>();
  for (const row of dismissed.data ?? []) counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1);
  const offerOff = [...counts].filter(([kind, count]) => count >= OFFER_OFF_AFTER && isHeadsupKind(kind) && !disabledKinds.includes(kind)).map(([kind]) => kind as HeadsupKind);
  return { state: 'ready', headsups, disabledKinds, offerOff };
}
