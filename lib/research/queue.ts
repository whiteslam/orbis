// Queueing runs: the app's whole share of a run. It checks the owner's caps,
// inserts the rows and starts the worker; everything after that is the
// worker's. Pure apart from the injected database and dispatch, so the rules
// are tested without Supabase or GitHub.

import type { DispatchInput, DispatchResult } from '@/lib/research/dispatch';
import type { PortfolioContext, ResearchSettings, RunSource } from '@/lib/research/types';
import type { ResearchTarget } from '@/lib/research/tickers';

export type NewRunRow = {
  user_id: string;
  ticker: string;
  symbol: string;
  exchange: 'NSE' | 'BSE';
  trade_date: string;
  source: RunSource;
  status: 'queued';
  portfolio_context: PortfolioContext;
  config: Record<string, unknown>;
};

/** What queueing needs from the database (lib/research/repository.ts, as the service role). */
export type QueueDb = {
  countRunsSince(userId: string, sinceIso: string): Promise<number>;
  activeTickers(userId: string): Promise<string[]>;
  insertRun(row: NewRunRow): Promise<string>;
  markDispatched(runIds: string[]): Promise<void>;
  markFailed(runIds: string[], message: string): Promise<void>;
  /** queued|running → cancelled, conditionally; false when the run was neither. */
  cancel(userId: string, runId: string): Promise<boolean>;
};

export type QueueDeps = { db: QueueDb; dispatch: (input: DispatchInput) => Promise<DispatchResult>; configured: boolean };

type Listed = Extract<ResearchTarget, { ok: true }>;

export type QueueInput = {
  userId: string;
  targets: Listed[];
  portfolio: PortfolioContext;
  settings: ResearchSettings;
  source: RunSource;
  now: Date;
};

export type QueueResult = { ok: true; runIds: string[]; skipped: string[] } | { ok: false; message: string };

/** Indian tickers only, so `social` (US forums) is never asked for (the spec's decision 5). */
export const INDIA_ANALYSTS = ['market', 'fundamentals', 'news'] as const;

const IST_OFFSET_MS = 330 * 60_000;

/** Today's date in India, YYYY-MM-DD. */
export function istDate(now: Date) {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant the current month began in India, as an ISO string. */
export function istMonthStart(now: Date) {
  const local = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - IST_OFFSET_MS).toISOString();
}

export const NOT_CONFIGURED_MESSAGE = 'The research worker isn’t set up on this server yet.';
export const DISPATCH_FAILED_MESSAGE = 'The research worker couldn’t be started. Try again in a little while.';

/**
 * Queues runs for these tickers and starts one workflow run for all of them.
 * A ticker already queued or running is skipped, and so is anything past the
 * month's run cap; when every one is skipped the first reason is the answer.
 * If the worker can't be started, the rows are marked failed with the reason,
 * so nothing sits "queued" for ever.
 */
export async function queueRuns(deps: QueueDeps, input: QueueInput): Promise<QueueResult> {
  if (!deps.configured) return { ok: false, message: NOT_CONFIGURED_MESSAGE };
  if (!input.settings.enabled) return { ok: false, message: 'The Research desk is turned off in its settings.' };
  if (!input.targets.length) return { ok: false, message: 'There’s nothing to analyse.' };

  const [used, active] = await Promise.all([
    deps.db.countRunsSince(input.userId, istMonthStart(input.now)),
    deps.db.activeTickers(input.userId),
  ]);
  let room = Math.max(0, input.settings.monthlyRunCap - used);
  const busy = new Set(active);
  const tradeDate = istDate(input.now);
  const runIds: string[] = [];
  const skipped: string[] = [];
  let firstReason: string | null = null;

  for (const target of input.targets) {
    if (busy.has(target.ticker)) {
      skipped.push(target.ticker);
      firstReason ??= `${target.symbol} is already being analysed. Its run is below.`;
      continue;
    }
    if (room <= 0) {
      skipped.push(target.ticker);
      firstReason ??= `You’ve used this month’s ${input.settings.monthlyRunCap} runs. The desk opens again on the 1st, or raise the cap in its settings.`;
      continue;
    }
    busy.add(target.ticker);
    room -= 1;
    runIds.push(await deps.db.insertRun({
      user_id: input.userId,
      ticker: target.ticker,
      symbol: target.symbol,
      exchange: target.exchange,
      trade_date: tradeDate,
      source: input.source,
      status: 'queued',
      portfolio_context: input.portfolio,
      config: {
        analysts: [...INDIA_ANALYSTS],
        deepModel: input.settings.deepModel,
        quickModel: input.settings.quickModel,
        debateRounds: 1,
        riskRounds: 1,
        tokenCap: input.settings.runTokenCap,
      },
    }));
  }

  if (!runIds.length) return { ok: false, message: firstReason ?? 'Nothing was queued.' };

  const started = await deps.dispatch({ mode: 'run', runIds });
  if (!started.ok) {
    const why = started.reason === 'rejected' ? 'GitHub refused the request; check the token and repository' : 'GitHub couldn’t be reached';
    await deps.db.markFailed(runIds, `The worker couldn’t be started (${why}).`);
    return { ok: false, message: DISPATCH_FAILED_MESSAGE };
  }
  await deps.db.markDispatched(runIds);
  return { ok: true, runIds, skipped };
}

/** Stops a run: the worker sees the status at its next step and stops there. */
export async function cancelRun(deps: { db: QueueDb }, input: { userId: string; runId: string }): Promise<{ ok: true } | { ok: false; message: string }> {
  return (await deps.db.cancel(input.userId, input.runId))
    ? { ok: true }
    : { ok: false, message: 'That run has already finished.' };
}
