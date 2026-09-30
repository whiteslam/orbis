'use server';

import { APP_LOCK_MESSAGE, isAppUnlocked } from '@/lib/security/app-lock';
import { signedInSession } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { isHeadsupKind } from '@/lib/headsups/types';
import { isUuid } from '@/lib/validate/id';

type Result = { success: boolean; message: string };
const SNOOZE_MS = 3 * 86_400_000;

async function session() {
  const current = await signedInSession();
  if (!current) return { error: 'Sign in again to do this.' } as const;
  if (!(await isAppUnlocked(current.claims))) return { error: APP_LOCK_MESSAGE } as const;
  return current;
}

async function setStatus(id: unknown, change: { status?: 'done' | 'dismissed'; snoozed_until?: string }, done: string): Promise<Result> {
  if (!isUuid(id)) return { success: false, message: 'That heads-up could not be found.' };
  const current = await session();
  if ('error' in current) return { success: false, message: current.error };
  const { data, error } = await current.supabase.from('headsups').update(change).eq('id', id).eq('user_id', current.userId).select('id');
  if (error || !data?.length) {
    if (error) console.error('Updating a heads-up failed', error);
    return { success: false, message: 'That heads-up could not be updated. Try again.' };
  }
  return { success: true, message: done };
}

export async function snoozeHeadsupAction(id: unknown) {
  return setStatus(id, { snoozed_until: new Date(Date.now() + SNOOZE_MS).toISOString() }, 'Snoozed for 3 days.');
}

export async function dismissHeadsupAction(id: unknown) {
  return setStatus(id, { status: 'dismissed' }, 'Dismissed.');
}

export async function completeHeadsupAction(id: unknown) {
  return setStatus(id, { status: 'done' }, 'Done.');
}

export async function setHeadsupKindAction(kind: unknown, enabled: unknown): Promise<Result> {
  if (!isHeadsupKind(kind) || typeof enabled !== 'boolean') return { success: false, message: 'That setting could not be changed.' };
  const current = await session();
  if ('error' in current) return { success: false, message: current.error };
  const { data, error } = await current.supabase.from('headsup_preferences').select('disabled_kinds').eq('user_id', current.userId).maybeSingle();
  if (error || !data) return { success: false, message: 'Heads-up settings aren’t available yet. Open Today once, then try again.' };
  const disabled = new Set<string>(data.disabled_kinds ?? []);
  if (enabled) disabled.delete(kind); else disabled.add(kind);
  const saved = await current.supabase.from('headsup_preferences').update({ disabled_kinds: [...disabled] }).eq('user_id', current.userId);
  if (saved.error) {
    console.error('Saving heads-up settings failed', saved.error);
    return { success: false, message: 'That setting could not be saved. Try again.' };
  }
  return { success: true, message: enabled ? 'Orbis will check for this again.' : 'Orbis will stop checking for this.' };
}

/** Deletes every heads-up. The owner has no delete grant, so this uses the admin client, scoped to them. */
export async function clearHeadsupsAction(): Promise<Result> {
  const current = await session();
  if ('error' in current) return { success: false, message: current.error };
  const { error } = await createAdminClient().from('headsups').delete().eq('user_id', current.userId);
  if (error) {
    console.error('Clearing heads-ups failed', error);
    return { success: false, message: 'Heads-ups could not be cleared. Try again.' };
  }
  return { success: true, message: 'All heads-ups cleared.' };
}
