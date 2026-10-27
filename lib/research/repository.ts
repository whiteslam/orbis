import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTable } from '@/lib/supabase/errors';
import { readEvent, readRun, readSettings, readSettlement } from '@/lib/research/rows';
import type { NewRunRow, QueueDb } from '@/lib/research/queue';
import type { ResearchEvent, ResearchRun, ResearchSettings, ResearchSettlement } from '@/lib/research/types';

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
