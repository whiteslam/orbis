import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTable } from '@/lib/supabase/errors';
import { readEvent, readRun, readSettings, readSettlement } from '@/lib/research/rows';
import type { NewRunRow, QueueDb } from '@/lib/research/queue';
import type { ResearchEvent, ResearchRun, ResearchSettings, ResearchSettlement } from '@/lib/research/types';
import type { WeeklyHeadsup } from '@/lib/research/weekly';

// The Research desk tables (supabase/migrations/202610270003_research_desk.sql).
// Reads go through the owner's own session, so row-level security keeps them
// to their rows; every write takes the admin client, after the server action
// has checked the allowlist the database can't see.

export type ResearchDb = SupabaseClient;

/** An error whose message is safe to show as-is. */
export class ResearchError extends Error {}

const SETUP_MESSAGE = 'The Research desk isn’t set up yet. Try again in a little while.';
const LOAD_MESSAGE = 'The Research desk couldn’t be loaded. Try again in a little while.';
const SAVE_MESSAGE = 'That couldn’t be saved. Try again in a little while.';

function failed(error: { code?: string; message?: string }, message: string) {
  console.error(message, error);
  return new ResearchError(isMissingTable(error) ? SETUP_MESSAGE : message);
}

const RUN_COLUMNS = 'id,ticker,symbol,exchange,trade_date,source,status,portfolio_context,decision,cost_usd,tokens,error,dispatched_at,started_at,finished_at,created_at';

export async function listRuns(db: ResearchDb, userId: string, limit = 30): Promise<ResearchRun[]> {
  const { data, error } = await db.from('research_runs').select(RUN_COLUMNS).eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw failed(error, LOAD_MESSAGE);
  return (data ?? []).map(readRun).filter((run): run is ResearchRun => run !== null);
}

export async function getRun(db: ResearchDb, userId: string, runId: string): Promise<ResearchRun | null> {
  const { data, error } = await db.from('research_runs').select(RUN_COLUMNS).eq('user_id', userId).eq('id', runId).maybeSingle();
  if (error) throw failed(error, LOAD_MESSAGE);
  return readRun(data);
}

/** The run's events after `afterSeq`, in order: the live view asks for only what it hasn't got. */
export async function listEvents(db: ResearchDb, userId: string, runId: string, afterSeq = 0): Promise<ResearchEvent[]> {
  const { data, error } = await db.from('research_events').select('seq,agent,kind,content,at')
    .eq('user_id', userId).eq('run_id', runId).gt('seq', afterSeq).order('seq', { ascending: true }).limit(500);
  if (error) throw failed(error, LOAD_MESSAGE);
  return (data ?? []).map(readEvent).filter((event): event is ResearchEvent => event !== null);
}

const SETTLEMENT_COLUMNS = 'run_id,ticker,trade_date,benchmark,holding_days,return_pct,benchmark_pct,alpha_pct,reflection,settled_at';

export async function listSettlements(db: ResearchDb, userId: string, limit = 60): Promise<ResearchSettlement[]> {
  const { data, error } = await db.from('research_settlements').select(SETTLEMENT_COLUMNS).eq('user_id', userId).order('trade_date', { ascending: false }).limit(limit);
  if (error) throw failed(error, LOAD_MESSAGE);
  return (data ?? []).map(readSettlement).filter((row): row is ResearchSettlement => row !== null);
}

export async function getSettlement(db: ResearchDb, userId: string, runId: string): Promise<ResearchSettlement | null> {
  const { data, error } = await db.from('research_settlements').select(SETTLEMENT_COLUMNS).eq('user_id', userId).eq('run_id', runId).maybeSingle();
  if (error) throw failed(error, LOAD_MESSAGE);
  return readSettlement(data);
}

export async function getSettings(db: ResearchDb, userId: string): Promise<ResearchSettings> {
  const { data, error } = await db.from('research_settings').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw failed(error, LOAD_MESSAGE);
  return readSettings(data);
}

export async function saveSettings(admin: ResearchDb, userId: string, settings: ResearchSettings): Promise<void> {
  const { error } = await admin.from('research_settings').upsert({
    user_id: userId,
    enabled: settings.enabled,
    weekly_enabled: settings.weeklyEnabled,
    weekly_top_n: settings.weeklyTopN,
    deep_model: settings.deepModel,
    quick_model: settings.quickModel,
    run_token_cap: settings.runTokenCap,
    monthly_run_cap: settings.monthlyRunCap,
  }, { onConflict: 'user_id' });
  if (error) throw failed(error, SAVE_MESSAGE);
}

/** Runs created since `sinceIso`, whatever became of them: the monthly cap counts presses, not results. */
export async function countRunsSince(db: ResearchDb, userId: string, sinceIso: string): Promise<number> {
  const { count, error } = await db.from('research_runs').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', sinceIso);
  if (error) throw failed(error, LOAD_MESSAGE);
  return count ?? 0;
}

/** Queueing's database, as the service role. */
export function researchQueueDb(admin: ResearchDb): QueueDb {
  return {
    countRunsSince: (userId, sinceIso) => countRunsSince(admin, userId, sinceIso),
    async activeTickers(userId) {
      const { data, error } = await admin.from('research_runs').select('ticker').eq('user_id', userId).in('status', ['queued', 'running'])
        // A run that never started or never finished doesn't block a new one (see effectiveStatus).
        .gte('created_at', new Date(Date.now() - 2 * 60 * 60_000).toISOString());
      if (error) throw failed(error, LOAD_MESSAGE);
      return (data ?? []).map((row) => String(row.ticker));
    },
    async insertRun(row: NewRunRow) {
      const { data, error } = await admin.from('research_runs').insert(row).select('id').single();
      if (error || !data) throw failed(error ?? {}, SAVE_MESSAGE);
      return String(data.id);
    },
    async markDispatched(runIds) {
      const { error } = await admin.from('research_runs').update({ dispatched_at: new Date().toISOString() }).in('id', runIds).eq('status', 'queued');
      if (error) console.error('Marking research runs dispatched failed', error);
    },
    async markFailed(runIds, message) {
      const { error } = await admin.from('research_runs').update({ status: 'failed', error: message.slice(0, 500), finished_at: new Date().toISOString() })
        .in('id', runIds).eq('status', 'queued');
      if (error) console.error('Marking research runs failed failed', error);
    },
    async cancel(userId, runId) {
      const { data, error } = await admin.from('research_runs').update({ status: 'cancelled', finished_at: new Date().toISOString() })
        .eq('user_id', userId).eq('id', runId).in('status', ['queued', 'running']).select('id');
      if (error) throw failed(error, SAVE_MESSAGE);
      return (data ?? []).length > 0;
    },
  };
}

// ─── The weekly cron (app/api/research/weekly), as the service role ────────

/** Calls older than this aren't chased for a settlement any more. */
const SETTLE_LOOKBACK_DAYS = 90;
const CRON_ROWS = 1000;

const daysBefore = (isoDate: string, days: number) => new Date(Date.parse(`${isoDate}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/**
 * Everyone the Saturday pass may have work for: weekly runs turned on, or a
 * finished call in the settling window. The cron still checks each one
 * against the allowlist, which the database can't see.
 */
export async function weeklyCandidates(admin: ResearchDb, today: string): Promise<string[]> {
  const [settings, runs] = await Promise.all([
    admin.from('research_settings').select('user_id').eq('enabled', true).eq('weekly_enabled', true).limit(CRON_ROWS),
    admin.from('research_runs').select('user_id').eq('status', 'done').gte('trade_date', daysBefore(today, SETTLE_LOOKBACK_DAYS)).limit(CRON_ROWS),
  ]);
  if (settings.error) throw failed(settings.error, LOAD_MESSAGE);
  if (runs.error) throw failed(runs.error, LOAD_MESSAGE);
  return [...new Set([...(settings.data ?? []), ...(runs.data ?? [])].map((row) => String(row.user_id)))];
}

/** The account's email, for the allowlist check; null when it can't be read. */
export async function accountEmail(admin: ResearchDb, userId: string): Promise<string | null> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) return null;
  return data.user?.email ?? null;
}

/** Whether a finished call older than `olderThanDays` (within the lookback) has no settlement yet. */
export async function hasUnsettledDue(admin: ResearchDb, userId: string, today: string, olderThanDays: number): Promise<boolean> {
  const { data, error } = await admin.from('research_runs').select('id').eq('user_id', userId).eq('status', 'done')
    .lt('trade_date', daysBefore(today, olderThanDays)).gte('trade_date', daysBefore(today, SETTLE_LOOKBACK_DAYS)).limit(CRON_ROWS);
  if (error) throw failed(error, LOAD_MESSAGE);
  const ids = (data ?? []).map((row) => String(row.id));
  if (!ids.length) return false;
  const settled = await admin.from('research_settlements').select('run_id').eq('user_id', userId).in('run_id', ids);
  if (settled.error) throw failed(settled.error, LOAD_MESSAGE);
  return new Set((settled.data ?? []).map((row) => String(row.run_id))).size < ids.length;
}

/** Whether this week's weekly runs were queued already, so a second cron call queues nothing. */
export async function hasWeeklyRunsOn(admin: ResearchDb, userId: string, tradeDate: string): Promise<boolean> {
  const { count, error } = await admin.from('research_runs').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('source', 'weekly').eq('trade_date', tradeDate);
  if (error) throw failed(error, LOAD_MESSAGE);
  return (count ?? 0) > 0;
}

/** Weekly runs with a trade date in [from, to), everyone's, by owner. */
export async function weeklyRunsBetween(admin: ResearchDb, from: string, to: string): Promise<Map<string, ResearchRun[]>> {
  const { data, error } = await admin.from('research_runs').select(`user_id,${RUN_COLUMNS}`).eq('source', 'weekly')
    .gte('trade_date', from).lt('trade_date', to).limit(CRON_ROWS);
  if (error) throw failed(error, LOAD_MESSAGE);
  const byUser = new Map<string, ResearchRun[]>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const run = readRun(row);
    if (!run) continue;
    const userId = String(row.user_id);
    byUser.set(userId, [...(byUser.get(userId) ?? []), run]);
  }
  return byUser;
}

/**
 * Saves the Monday heads-up the way Career's watcher saves its own: worded by
 * rules, skipped when the owner turned the kind off, and a no-op the second
 * time thanks to the dedupe key. Returns whether a row was written.
 */
export async function raiseWeeklyHeadsup(admin: ResearchDb, userId: string, headsup: WeeklyHeadsup): Promise<boolean> {
  const prefs = await admin.from('headsup_preferences').select('disabled_kinds').eq('user_id', userId).maybeSingle();
  const disabled = Array.isArray(prefs.data?.disabled_kinds) ? (prefs.data.disabled_kinds as string[]) : [];
  if (disabled.includes(headsup.kind)) return false;
  const { data, error } = await admin.from('headsups').upsert({
    user_id: userId, kind: headsup.kind, dedupe_key: headsup.dedupeKey, urgency: headsup.urgency, evidence: headsup.evidence,
    title: headsup.title, body: headsup.body, action: headsup.action, action_label: headsup.actionLabel, worded_by: 'rules', status: 'new',
  }, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true }).select('id');
  if (error) {
    console.error('Saving the weekly research heads-up failed', error);
    return false;
  }
  return (data ?? []).length > 0;
}
