import { cronAuthorized } from '@/lib/cron/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadLivePortfolio } from '@/lib/invest/live';
import { researchDeskAvailable } from '@/lib/research/access';
import { deskHoldings, portfolioContextFor } from '@/lib/research/context';
import { dispatchConfig, dispatchRuns, type DispatchConfig } from '@/lib/research/dispatch';
import { queueRuns } from '@/lib/research/queue';
import { getRoleAdmin } from '@/lib/security/roles';
import { localDate } from '@/lib/locale/dates';
import { DEFAULT_PERSON_LOCALE } from '@/lib/locale/person';
import { getPersonSettingsAdmin } from '@/lib/locale/repository';
import {
  accountEmail, getSettings, hasUnsettledDue, hasWeeklyRunsOn, raiseWeeklyHeadsup, researchQueueDb, weeklyCandidates, weeklyRunsBetween,
  type ResearchDb,
} from '@/lib/research/repository';
import type { ResearchSettings } from '@/lib/research/types';
import { mondayOf, weekBefore, weeklyHeadsup, weeklyPicks } from '@/lib/research/weekly';

export const maxDuration = 60;

const TIME_BUDGET_MS = 50_000;
/** A call needs its holding period behind it before it can settle. */
const SETTLE_AFTER_DAYS = 8;

type Owner = { userId: string; email: string; settings: ResearchSettings; timeZone: string };

/**
 * The owners this run is for: holding the owner role (or on the fallback
 * email list), with the desk on in its settings. Each account found in the
 * tables is checked here.
 */
async function* owners(admin: ResearchDb, userIds: Iterable<string>, deadline: number): AsyncGenerator<Owner> {
  for (const userId of userIds) {
    if (Date.now() > deadline) return;
    const email = await accountEmail(admin, userId);
    if (!email || !researchDeskAvailable(await getRoleAdmin(admin, userId), email, true)) continue;
    const settings = await getSettings(admin, userId);
    if (!settings.enabled) continue;
    const { timeZone } = await getPersonSettingsAdmin(admin, userId);
    yield { userId, email, settings, timeZone };
  }
}

/** Saturday, 09:00 IST: settle due calls, then queue the weekly batch when it is on. */
async function queueStep(admin: ResearchDb, config: DispatchConfig, now: Date, deadline: number) {
  // Finding candidates looks back weeks, so the default zone is close enough; each owner's own day is used below.
  const candidatesFrom = localDate(now, DEFAULT_PERSON_LOCALE.timeZone);
  const summary = { users: 0, settling: 0, queued: 0, failed: 0 };
  for await (const owner of owners(admin, await weeklyCandidates(admin, candidatesFrom), deadline)) {
    summary.users += 1;
    const today = localDate(now, owner.timeZone);
    try {
      if (await hasUnsettledDue(admin, owner.userId, today, SETTLE_AFTER_DAYS)) {
        const started = await dispatchRuns({ mode: 'settle', runIds: [], userId: owner.userId }, { config });
        if (started.ok) summary.settling += 1;
        else summary.failed += 1;
      }
      const { settings } = owner;
      if (!settings.weeklyEnabled || (await hasWeeklyRunsOn(admin, owner.userId, today))) continue;
      const holdings = deskHoldings((await loadLivePortfolio(owner.userId, owner.email)).brokers);
      const picks = weeklyPicks(holdings, settings.weeklyTopN);
      if (!picks.length) continue;
      const queued = await queueRuns(
        { db: researchQueueDb(admin), dispatch: (request) => dispatchRuns(request, { config }), configured: true },
        { userId: owner.userId, targets: picks, portfolio: portfolioContextFor(holdings), settings, source: 'weekly', now, timeZone: owner.timeZone },
      );
      // The refusal's message can name a ticker, so only the count is kept.
      if (queued.ok) summary.queued += queued.runIds.length;
    } catch (error) {
      summary.failed += 1;
      console.error('The weekly research pass failed for one owner', error instanceof Error ? error.name : 'unknown');
    }
  }
  return summary;
}

/** Monday, 08:00 IST: a heads-up for each owner whose weekly runs finished. */
async function summaryStep(admin: ResearchDb, now: Date, deadline: number) {
  // Everyone's weekly runs are read at once, so the week is placed in the default zone.
  const weekOf = mondayOf(localDate(now, DEFAULT_PERSON_LOCALE.timeZone));
  const byUser = await weeklyRunsBetween(admin, weekBefore(weekOf), weekOf);
  const summary = { users: 0, raised: 0 };
  for await (const owner of owners(admin, byUser.keys(), deadline)) {
    summary.users += 1;
    const headsup = weeklyHeadsup(byUser.get(owner.userId) ?? [], weekOf);
    if (headsup && (await raiseWeeklyHeadsup(admin, owner.userId, headsup))) summary.raised += 1;
  }
  return summary;
}

// Called by pg_cron (supabase/cron/research_schedule.sql): ?step=queue on
// Saturday morning and ?step=summary on Monday morning, India time. Until the
// desk is set up on this deployment (the worker's env vars) it answers without touching a single research table.
export async function POST(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const step = new URL(request.url).searchParams.get('step');
  if (step !== 'queue' && step !== 'summary') return Response.json({ error: 'Unknown step.' }, { status: 400 });

  const config = dispatchConfig();
  if (!config) return Response.json({ step, skipped: 'not_configured' });

  const now = new Date();
  const deadline = Date.now() + TIME_BUDGET_MS;
  const admin = createAdminClient();
  try {
    const result = step === 'queue' ? await queueStep(admin, config, now, deadline) : await summaryStep(admin, now, deadline);
    return Response.json({ step, ...result });
  } catch (error) {
    console.error('The weekly research cron failed', error);
    return Response.json({ error: 'The weekly research pass could not run.' }, { status: 500 });
  }
}
