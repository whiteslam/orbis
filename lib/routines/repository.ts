import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { localParts } from '@/lib/routines/today';
import type { Routine, RoutineEvent, RoutineKind, RoutineStatus, RoutinesSummary } from '@/lib/routines/types';

const isMissingTable = (code?: string) => ['PGRST205', 'PGRST204', '42P01'].includes(code ?? '');

function toRoutine(row: Record<string, unknown>): Routine {
  return {
    id: String(row.id),
    title: String(row.title),
    kind: row.kind as RoutineKind,
    // Postgres returns "19:00:00"; the brief only ever wants hours and minutes.
    atTime: String(row.at_time).slice(0, 5),
    days: Array.isArray(row.days) ? (row.days as number[]).map(Number) : [],
    active: row.active !== false,
    flexible: row.flexible === true,
    archivedAt: typeof row.archived_at === 'string' ? row.archived_at : null,
  };
}

function toEvent(row: Record<string, unknown>): RoutineEvent {
  return {
    id: String(row.id),
    routineId: typeof row.routine_id === 'string' ? row.routine_id : null,
    title: String(row.title),
    localDate: String(row.local_date),
    status: row.status as RoutineStatus,
    note: typeof row.note === 'string' ? row.note : null,
  };
}

/**
 * The routines and today's answers, in one read.
 *
 * Before the migration is applied this reports 'setup' rather than failing, the
 * same way every other optional table in Orbis does: the brief simply has no
 * schedule to talk about.
 */
export async function getRoutinesSummary(userId: string, now = new Date()): Promise<RoutinesSummary> {
  try {
    const supabase = await createClient();
    const today = localParts(now).date;
    const listRoutines = (columns: string) => supabase.from('routines').select(columns).eq('user_id', userId).order('at_time').limit(60);
    const [first, events] = await Promise.all([
      listRoutines('id,title,kind,at_time,days,active,archived_at,flexible'),
      supabase.from('routine_events').select('id,routine_id,title,local_date,status,note').eq('user_id', userId).eq('local_date', today).limit(40),
    ]);
    // Before the routine_flexible migration there is no flexible column, and
    // before the archive migration no archived_at; the day still works without
    // either, every routine simply counted as exact.
    const second = first.error?.code === '42703' ? await listRoutines('id,title,kind,at_time,days,active,archived_at') : first;
    const routines = second.error?.code === '42703' ? await listRoutines('id,title,kind,at_time,days,active') : second;
    const error = routines.error ?? events.error;
    if (error) return { state: isMissingTable(error.code) ? 'setup' : 'unavailable', routines: [], events: [] };
    return {
      state: 'ready',
      routines: ((routines.data ?? []) as unknown as Record<string, unknown>[]).map(toRoutine),
      events: (events.data ?? []).map(toEvent),
    };
  } catch {
    return { state: 'unavailable', routines: [], events: [] };
  }
}

export type RoutineDraft = { title: string; kind: RoutineKind; atTime: string; days: number[]; flexible: boolean };

export async function saveRoutine(userId: string, draft: RoutineDraft, id?: string) {
  const supabase = await createClient();
  const row = { user_id: userId, title: draft.title, kind: draft.kind, at_time: draft.atTime, days: draft.days, updated_at: new Date().toISOString() };
  const save = (values: Record<string, unknown>) => (id
    ? supabase.from('routines').update(values).eq('id', id).eq('user_id', userId)
    : supabase.from('routines').insert(values));
  let { error } = await save({ ...row, flexible: draft.flexible });
  // Before the routine_flexible migration the column is missing: keep the
  // routine, which is what was asked for, and say what is needed for the flag.
  if (error?.code === '42703') {
    ({ error } = await save(row));
    if (!error && draft.flexible) throw new Error('Saved, but "usually around" needs the routine_flexible migration in Supabase.');
  }
  if (error) throw new Error(isMissingTable(error.code) ? 'Apply the routines migration in Supabase, then try again.' : 'That routine could not be saved.');
}

/**
 * Puts a routine away, or brings it back. Archived routines leave the brief and
 * notifications but keep their name, time, days and everything logged.
 */
export async function setRoutineArchived(userId: string, id: string, archived: boolean) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('routines')
    .update({ active: !archived, archived_at: archived ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();
  if (error?.code === '42703') throw new Error('Apply the routine archive migration in Supabase, then try again.');
  if (error || !data) throw new Error(archived ? 'That routine could not be archived.' : 'That routine could not be restored.');
}

/** Permanent removal, offered only from the archive. What was logged against it is kept. */
export async function deleteRoutine(userId: string, id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from('routines').delete().eq('id', id).eq('user_id', userId);
  if (error) throw new Error('That routine could not be removed.');
}

/**
 * Records what happened to a routine today, replacing any earlier answer.
 *
 * Answering twice is a correction, not a second event: a day cannot hold both
 * "done" and "skipped" for the same routine, which the unique index enforces.
 */
export async function recordRoutineEvent(
  userId: string,
  input: { routineId: string; title: string; status: RoutineStatus; note: string | null },
  now = new Date(),
) {
  const supabase = await createClient();
  const localDate = localParts(now).date;
  const { error } = await supabase
    .from('routine_events')
    .upsert({
      user_id: userId,
      routine_id: input.routineId,
      title: input.title,
      local_date: localDate,
      status: input.status,
      note: input.note,
    }, { onConflict: 'user_id,routine_id,local_date' });
  if (error) throw new Error(isMissingTable(error.code) ? 'Apply the routines migration in Supabase, then try again.' : 'That could not be saved.');
}

export async function clearRoutineEvent(userId: string, routineId: string, now = new Date()) {
  const supabase = await createClient();
  await supabase.from('routine_events').delete().eq('user_id', userId).eq('routine_id', routineId).eq('local_date', localParts(now).date);
}
