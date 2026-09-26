// The snapshot the Home brief is written from, and the fingerprint that decides
// when it must be written again.
//
// The prompt and the reply parser moved to lib/brief/compose.ts when the note
// and the push notification became one writer; this module is only about facts.
//
// Two rules shape it. The model never does arithmetic: every figure is
// formatted before it is sent, so a caption can only repeat a number Orbis
// already computed. And the brief is cached against a fingerprint of the
// snapshot rather than against the clock, so answering an alert or finishing a
// routine writes a new one, while a minute passing does not.
import { createHash } from 'node:crypto';
import { count, istParts, money } from '@/lib/focus/types';
import type { FinanceSummary } from '@/lib/finance/types';

export type BriefRoutine = { title: string; kind: string; at: string; minutesAway: number; answered: string | null };
export type BriefWeatherFacts = { temperature: number; feelsLike: number; condition: string; rainingNow: boolean; rainPeak: { probability: number; hour: string } | null };

export type BriefSnapshot = {
  /** Every value is already formatted for display; the model only quotes them. */
  today: string;
  partOfDay: string;
  localTime: string;
  name: string | null;
  finance: {
    available: boolean;
    connected: boolean;
    needsReconnect: boolean;
    alertsToConfirm: number;
    spentThisMonth: string | null;
    perDay: string | null;
    topCategory: string | null;
  };
  /** What is due around now, and what already went by unanswered. */
  routine: BriefRoutine | null;
  missedCount: number;
  documentCount: number;
  weather: BriefWeatherFacts | null;
};

function partOfDay(hour: number) {
  if (hour < 5) return 'late night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'night';
}

export function briefSnapshot(input: {
  finance: FinanceSummary;
  documentCount: number;
  routine?: BriefRoutine | null;
  missedCount?: number;
  name: string | null;
  weather?: BriefWeatherFacts | null;
  now?: Date;
}): BriefSnapshot {
  const now = input.now ?? new Date();
  const today = istParts(now);
  const todayKey = `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;

  const spend = input.finance.monthlyExpenses.length === 1 ? input.finance.monthlyExpenses[0] : null;
  const topCategory = (() => {
    if (!spend) return null;
    const totals = new Map<string, number>();
    for (const transaction of input.finance.transactions) {
      const when = istParts(new Date(transaction.occurredAt));
      if (transaction.direction !== 'expense' || !transaction.category || when.year !== today.year || when.month !== today.month) continue;
      totals.set(transaction.category, (totals.get(transaction.category) ?? 0) + transaction.amount);
    }
    return Array.from(totals).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
  })();

  return {
    today: todayKey,
    partOfDay: partOfDay(today.hour),
    localTime: new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(now),
    name: input.name?.trim().split(/\s+/)[0] || null,
    finance: {
      available: input.finance.databaseReady && !input.finance.loadError,
      connected: Boolean(input.finance.connection),
      needsReconnect: input.finance.connection?.status === 'reconnect_required',
      alertsToConfirm: input.finance.pendingCandidateCount,
      spentThisMonth: spend && spend.amount > 0 ? money(spend.amount, spend.currency) : null,
      perDay: spend && spend.amount > 0 ? money(spend.amount / Math.max(today.day, 1), spend.currency) : null,
      topCategory,
    },
    routine: input.routine ?? null,
    missedCount: input.missedCount ?? 0,
    documentCount: input.documentCount,
    weather: input.weather ?? null,
  };
}

/**
 * Identifies the data a brief was written about.
 *
 * localTime is excluded and partOfDay is not. A caption is written for a
 * stretch of the day (a workout is a plan at 8am and a missed session at 9pm)
 * so it must be rewritten when that stretch turns, four or five times a day.
 * Keeping the clock minute here would rewrite it every minute.
 *
 * A routine's exact minutesAway is likewise rounded away: the brief should not
 * regenerate because "in 25 minutes" became "in 24 minutes".
 */
export function snapshotFingerprint(snapshot: BriefSnapshot) {
  const { localTime: _ignored, weather, routine, ...rest } = snapshot;
  const stable = {
    ...rest,
    routine: routine
      ? { title: routine.title, kind: routine.kind, at: routine.at, answered: routine.answered, due: routine.minutesAway > 45 ? 'later' : routine.minutesAway >= -90 ? 'now' : 'gone' }
      : null,
    weather: weather
      ? { raining: weather.rainingNow, rain: (weather.rainPeak?.probability ?? 0) >= 60, hot: weather.temperature >= 36, cold: weather.temperature <= 12 }
      : null,
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 32);
}

/** A one-line summary of the snapshot, so a saved brief is identifiable. */
export function snapshotSummary(snapshot: BriefSnapshot) {
  return [
    snapshot.routine ? snapshot.routine.title : null,
    snapshot.finance.alertsToConfirm ? count(snapshot.finance.alertsToConfirm, 'alert') : null,
    snapshot.documentCount ? count(snapshot.documentCount, 'document') : null,
  ].filter(Boolean).join(', ') || 'nothing connected';
}
