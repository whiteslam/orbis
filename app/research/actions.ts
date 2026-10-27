'use server';

// The Research desk's server actions: the contract between Money → Investments
// (and the panel at /active/research) and lib/research. Every one checks the
// signed-in owner and the desk's own allowlist (ORBIS_RESEARCH_DESK_EMAILS)
// first, then validates what the browser sent. The app only queues and reads:
// a run takes 3-10 minutes, so the Python worker on GitHub Actions does it.
// Nothing here talks to a broker except to read holdings, and nothing places,
// stages or suggests an order.

import { revalidatePath } from 'next/cache';
import { claimsEmail, requireUser } from '@/lib/auth/session';
import { isUuid } from '@/lib/validate/id';
import { rateLimitRefusal } from '@/lib/security/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadLivePortfolio } from '@/lib/invest/live';
import { researchDeskAllowed } from '@/lib/research/access';
import { deskHoldings, portfolioContextFor } from '@/lib/research/context';
import { dispatchConfig, dispatchRuns } from '@/lib/research/dispatch';
import { cancelRun, istMonthStart, queueRuns } from '@/lib/research/queue';
import {
  countRunsSince, getRun, getSettings, getSettlement, listEvents, listRuns, listSettlements, researchQueueDb, ResearchError, saveSettings,
  type ResearchDb,
} from '@/lib/research/repository';
import { applySettingsPatch, effectiveStatus } from '@/lib/research/rows';
import { parseTypedTicker, type ResearchTarget } from '@/lib/research/tickers';
import { FUND_UNSUPPORTED, type ResearchRun, type ResearchSettings } from '@/lib/research/types';
import type { ResearchDesk, Result, RunDetail } from '@/lib/research/view';

const SIGN_IN = { success: false as const, message: 'Sign in again to do this.' };
const NOT_HERE = { success: false as const, message: 'The Research desk isn’t available on this account.' };
const INVALID = { success: false as const, message: 'That request isn’t valid. Reload and try again.' };

const ok = <T,>(data: T): Result<T> => ({ success: true, data });
const fail = (message: string) => ({ success: false as const, message });

type Owner = { userId: string; email: string | null; db: ResearchDb };

/** The signed-in owner, if the desk is theirs; null otherwise. */
async function owner(): Promise<Owner | 'signed-out' | 'not-allowed'> {
  const signedIn = await requireUser();
  if (!signedIn) return 'signed-out';
  const email = claimsEmail(signedIn.claims);
  if (!researchDeskAllowed(email)) return 'not-allowed';
  return { userId: signedIn.userId, email, db: signedIn.supabase };
}

function messageOf(error: unknown, fallback: string) {
  if (error instanceof ResearchError) return error.message;
  console.error(fallback, error);
  return fallback;
}

async function asOwner<T>(fallback: string, work: (me: Owner) => Promise<Result<T>>): Promise<Result<T>> {
  const me = await owner();
  if (me === 'signed-out') return SIGN_IN;
  if (me === 'not-allowed') return NOT_HERE;
  try {
    return await work(me);
  } catch (error) {
    return fail(messageOf(error, fallback));
  }
}

function refresh() {
  revalidatePath('/active/research');
}

const withStatus = (runs: ResearchRun[], now = new Date()) => runs.map((run) => ({ ...run, status: effectiveStatus(run, now) }));

/**
 * The desk for Money → Investments and the panel. Null (not a failure) for
 * anyone the desk isn't for, so the Investments screen simply doesn't show it.
 */
export async function loadResearchDeskAction(): Promise<Result<ResearchDesk | null>> {
  const me = await owner();
  if (me === 'signed-out') return SIGN_IN;
  if (me === 'not-allowed') return ok(null);
  try {
    const [runs, settlements, settings, monthUsed] = await Promise.all([
      listRuns(me.db, me.userId),
      listSettlements(me.db, me.userId),
      getSettings(me.db, me.userId),
      countRunsSince(me.db, me.userId, istMonthStart(new Date())),
    ]);
    return ok({ runs: withStatus(runs), settlements, settings, configured: dispatchConfig() !== null, monthUsed });
  } catch (error) {
    return fail(messageOf(error, 'The Research desk couldn’t be loaded. Try again in a little while.'));
  }
}

function targetMessage(target: Extract<ResearchTarget, { ok: false }>) {
  return target.reason === 'fund'
    ? `${FUND_UNSUPPORTED}: TradingAgents reads exchange prices, and a fund has none.`
    : 'That isn’t an NSE or BSE ticker. Try a symbol like RELIANCE, NSE:INFY or BSE:500325.';
}

/**
 * Deep analysis on one holding (by its key on the Investments screen) or on
 * any NSE/BSE ticker the owner typed. The holdings are read again here, never
 * taken from the browser, and only their tickers, quantities and average
 * prices go to the worker.
 */
export async function startResearchAction(input: unknown): Promise<Result<{ runId: string }>> {
  if (!input || typeof input !== 'object') return INVALID;
  const { holdingKey, ticker } = input as { holdingKey?: unknown; ticker?: unknown };
  const byKey = typeof holdingKey === 'string' && holdingKey.length > 0 && holdingKey.length <= 80;
  const byTicker = typeof ticker === 'string' && ticker.trim().length > 0 && ticker.length <= 40;
  if (byKey === byTicker) return INVALID;

  return asOwner('The run couldn’t be started. Try again in a little while.', async (me) => {
    const limited = await rateLimitRefusal(me.userId, 'research_run');
    if (limited) return fail(limited);

    const live = await loadLivePortfolio(me.userId, me.email);
    const holdings = deskHoldings(live.brokers);
    let target: ResearchTarget;
    if (byKey) {
      const holding = holdings.find((item) => item.key === holdingKey);
      if (!holding) return fail('That holding isn’t in your accounts any more. Refresh Investments and try again.');
      target = holding.target;
    } else {
      target = parseTypedTicker(ticker as string);
    }
    if (!target.ok) return fail(targetMessage(target));

    const admin = createAdminClient();
    const settings = await getSettings(me.db, me.userId);
    const queued = await queueRuns(
      { db: researchQueueDb(admin), dispatch: (request) => dispatchRuns(request, { config: dispatchConfig() }), configured: dispatchConfig() !== null },
      { userId: me.userId, targets: [target], portfolio: portfolioContextFor(holdings), settings, source: 'manual', now: new Date() },
    );
    refresh();
    if (!queued.ok) return fail(queued.message);
    return ok({ runId: queued.runIds[0] });
  });
}

/** One run with the events after `afterSeq`: the live view polls this while the run is working. */
export async function loadResearchRunAction(runId: unknown, afterSeq: unknown = 0): Promise<Result<RunDetail>> {
  if (!isUuid(runId) || typeof afterSeq !== 'number' || !Number.isInteger(afterSeq) || afterSeq < 0) return INVALID;
  return asOwner('That run couldn’t be loaded. Try again in a little while.', async (me) => {
    const run = await getRun(me.db, me.userId, runId);
    if (!run) return fail('That run isn’t here any more.');
    const [events, settlement] = await Promise.all([
      listEvents(me.db, me.userId, runId, afterSeq),
      run.status === 'done' ? getSettlement(me.db, me.userId, runId) : Promise.resolve(null),
    ]);
    return ok({ run: { ...run, status: effectiveStatus(run, new Date()) }, events, settlement });
  });
}

/** Stops a queued or running run; the worker stops at its next step. */
export async function cancelResearchRunAction(runId: unknown): Promise<Result<{ runId: string }>> {
  if (!isUuid(runId)) return INVALID;
  return asOwner('That run couldn’t be stopped. Try again in a little while.', async (me) => {
    const done = await cancelRun({ db: researchQueueDb(createAdminClient()) }, { userId: me.userId, runId });
    refresh();
    return done.ok ? ok({ runId }) : fail(done.message);
  });
}

/** Weekly run, top N, models and caps. Every field is checked; one bad field refuses the change. */
export async function saveResearchSettingsAction(patch: unknown): Promise<Result<ResearchSettings>> {
  return asOwner('Your settings couldn’t be saved. Try again in a little while.', async (me) => {
    const current = await getSettings(me.db, me.userId);
    const next = applySettingsPatch(current, patch);
    if (!next) return INVALID;
    await saveSettings(createAdminClient(), me.userId, next);
    refresh();
    return ok(next);
  });
}
