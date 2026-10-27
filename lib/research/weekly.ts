// The weekly desk run (behind research_settings.weekly_enabled, off by
// default): which holdings it analyses on Saturday, and the heads-up that
// says on Monday that the calls are in. Pure, so it is tested without
// Supabase; app/api/research/weekly does the reading and writing.

import { URGENCY, type Evidence, type HeadsupAction } from '@/lib/headsups/types';
import type { DeskHolding } from '@/lib/research/context';
import type { ResearchTarget } from '@/lib/research/tickers';
import { RATINGS, RESEARCH_DISCLAIMER, type Rating, type ResearchRun } from '@/lib/research/types';

type Listed = Extract<ResearchTarget, { ok: true }>;

/**
 * Stocks and ETFs only. Funds and symbols the desk can't map are already
 * refused by researchTarget; gold and silver (GOLDBEES, SGBs) are left out of
 * the weekly batch too, since fundamentals and company news say little about
 * a metal. The owner can still analyse one by hand.
 */
const WEEKLY_CLASSES = new Set(['Stocks', 'ETFs']);

/**
 * The top `n` supported stock and ETF holdings by value. The same ticker held
 * on two brokers is one pick, at its combined value.
 */
export function weeklyPicks(holdings: DeskHolding[], n: number): Listed[] {
  if (n <= 0) return [];
  const byTicker = new Map<string, { target: Listed; value: number }>();
  for (const holding of holdings) {
    if (!holding.target.ok || !WEEKLY_CLASSES.has(holding.assetClass)) continue;
    const value = Number.isFinite(holding.value) ? holding.value : 0;
    const entry = byTicker.get(holding.target.ticker);
    if (entry) entry.value += value;
    else byTicker.set(holding.target.ticker, { target: holding.target, value });
  }
  return [...byTicker.values()].sort((left, right) => right.value - left.value).slice(0, n).map((entry) => entry.target);
}

const DAY_MS = 86_400_000;
const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
const isoOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** The Monday of the week an IST date (YYYY-MM-DD) falls in. */
export function mondayOf(isoDate: string): string {
  const day = dayNumber(isoDate);
  const weekday = new Date(day * DAY_MS).getUTCDay(); // 0 = Sunday
  return isoOf(day - ((weekday + 6) % 7));
}

/** The Monday a week before this one. */
export function weekBefore(monday: string): string {
  return isoOf(dayNumber(monday) - 7);
}

export type WeeklyHeadsup = {
  kind: 'money.research_week';
  dedupeKey: string;
  urgency: 'normal' | 'urgent';
  title: string;
  body: string;
  actionLabel: string;
  action: HeadsupAction;
  evidence: Evidence;
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Monday's heads-up for the weekly runs of the week before `weekOf` (a
 * Monday), or null when none of them finished. It counts calls by rating and
 * names no ticker, and carries the desk's disclaimer like every decision.
 */
export function weeklyHeadsup(runs: ResearchRun[], weekOf: string): WeeklyHeadsup | null {
  const from = weekBefore(weekOf);
  const week = runs.filter((run) => run.source === 'weekly' && run.tradeDate >= from && run.tradeDate < weekOf);
  const finished = week.filter((run) => run.status === 'done');
  if (!finished.length) return null;
  const unfinished = week.length - finished.length;

  const counts = new Map<Rating | 'REVIEW', number>();
  for (const run of finished) {
    const rating = run.decision?.rating ?? 'REVIEW';
    counts.set(rating, (counts.get(rating) ?? 0) + 1);
  }
  const parts = RATINGS.filter((rating) => counts.has(rating)).map((rating) => `${counts.get(rating)} ${rating}`);
  if (counts.has('REVIEW')) parts.push(`${counts.get('REVIEW')} to review`);

  const tally = `${plural(finished.length, 'call', 'calls')} finished: ${parts.join(', ')}.`;
  const missed = unfinished > 0 ? ` ${plural(unfinished, 'run', 'runs')} didn’t finish.` : '';
  return {
    kind: 'money.research_week',
    dedupeKey: `research-week:${weekOf}`,
    urgency: URGENCY['money.research_week'],
    title: 'Your weekend research is in',
    body: `${tally}${missed} ${RESEARCH_DISCLAIMER}`,
    actionLabel: 'Open the desk',
    action: { type: 'open_research' },
    evidence: { weekOf, finished: finished.length, unfinished },
  };
}
