import 'server-only';

import { aiAllowed } from '@/lib/ai/consent';
import { getAiPreferences } from '@/lib/ai/preferences';
import { getLatestAiResult, saveAiResult } from '@/lib/ai/results';
import type { SavedHomeBrief } from '@/lib/ai/saved';
import { briefSnapshot, snapshotFingerprint, snapshotSummary } from '@/lib/home/ai-brief';
import { writeBrief } from '@/lib/brief/compose';
import { getFinanceSummary } from '@/lib/finance/repository';
import { getHealthLibrary } from '@/lib/health-docs/repository';
import { getPersonalProfile } from '@/lib/personal/repository';
import { getRoutinesSummary } from '@/lib/routines/repository';
import { currentRoutine, missedRoutines, routineState, routinesToday } from '@/lib/routines/today';
import { clockLabel } from '@/lib/routines/types';
import { claimAiCredit } from '@/lib/ai/quota';
import { createAdminClient } from '@/lib/supabase/admin';

// The brief regenerates on a data change, not on every visit; a saved brief
// for the same snapshot costs nothing. It is rewritten when the stretch of the
// day turns and when the routine it speaks about moves from coming up to due
// to not heard about, which is most of a day's rewrites. Eight a day covers
// that and costs about ₹0.72 even when every one falls through to Claude.
// After the eighth, Home shows Orbis's own wording, which is always accurate,
// until tomorrow (India time). It has its own counter (lib/ai/quota.ts): a background brief
// must never eat a request the user wanted to spend on asking a question.
const DAILY_BRIEF_LIMIT = 8;

export type BriefResult =
  | { state: 'ok'; caption: string; generatedAt: string; fresh: boolean }
  | { state: 'off' }
  | { state: 'error'; message: string };

/** The weather the page already fetched; anything else about it is ignored. */
type WeatherInput = {
  temperature: number;
  feelsLike: number;
  condition: string;
  rainingNow: boolean;
  rainPeak: { probability: number; hour: string } | null;
} | null;

const clampTemp = (value: number) => Math.round(Math.max(-60, Math.min(60, value)));

function readWeather(value: unknown): WeatherInput {
  if (!value || typeof value !== 'object') return null;
  const { temperature, feelsLike, condition, rainingNow, rain } = value as Record<string, unknown>;
  if (typeof temperature !== 'number' || !Number.isFinite(temperature)) return null;
  const peak = (rain as { peak?: unknown })?.peak as Record<string, unknown> | undefined;
  return {
    temperature: clampTemp(temperature),
    feelsLike: typeof feelsLike === 'number' && Number.isFinite(feelsLike) ? clampTemp(feelsLike) : clampTemp(temperature),
    condition: typeof condition === 'string' ? condition.slice(0, 40) : '',
    rainingNow: rainingNow === true,
    // The hour is what makes a forecast quotable; a probability without one is
    // dropped, and so is an unlikely one: the model mentions whatever it is given.
    rainPeak: peak && typeof peak.probability === 'number' && Number.isFinite(peak.probability) && peak.probability >= 60 && typeof peak.hour === 'string'
      ? { probability: Math.round(Math.max(0, Math.min(100, peak.probability))), hour: peak.hour.slice(0, 12) }
      : null,
  };
}

/**
 * Returns the brief for today's data: the saved one when it was written about
 * exactly this snapshot, a freshly generated one otherwise.
 *
 * The snapshot is rebuilt here from the database rather than taken from the
 * page, so what reaches the model is always what Orbis actually holds. The
 * caller has already established who `userId` is and that the app is unlocked.
 */
export async function loadHomeBrief(userId: string, input: { weather?: unknown }): Promise<BriefResult> {
  const preferences = await getAiPreferences(userId);
  // With AI switched off, Home simply shows Orbis's own wording: no message,
  // because turning AI off is a choice, not a fault. Both checks (consent, and
  // a model that may see personal data) come before the daily credit below.
  if (!preferences.homeBriefEnabled || !aiAllowed(preferences)) return { state: 'off' };
  if (!preferences.configured) return { state: 'error', message: 'No AI provider that can hold personal data is available right now.' };

  const [finance, library, profile, routines] = await Promise.all([
    getFinanceSummary(userId),
    getHealthLibrary(userId),
    getPersonalProfile(userId),
    getRoutinesSummary(userId),
  ]);

  const due = routinesToday(routines, new Date());
  const current = currentRoutine(due);

  const full = briefSnapshot({
    finance,
    documentCount: library.documents.length,
    name: profile.profile?.preferredName ?? null,
    routine: current
      ? {
        title: current.routine.title,
        kind: current.routine.kind,
        at: clockLabel(current.routine.atTime),
        minutesAway: current.minutesAway,
        state: routineState(current),
        flexible: current.routine.flexible,
        answered: current.event ? current.event.note ?? current.event.status : null,
      }
      : null,
    missedCount: missedRoutines(due).length,
    weather: readWeather(input.weather),
  });
  // The month's spending already has its own tile right under the note, so the
  // note is never handed the figures: the same number twice on Home is noise.
  // The push notification has no tile beside it and keeps them.
  const snapshot = { ...full, finance: { available: full.finance.available, spentThisMonth: null, perDay: null, topCategory: null } };
  const fingerprint = snapshotFingerprint(snapshot);

  // A brief already written about these exact numbers is still true.
  const saved = await getLatestAiResult<string, { fingerprint?: string }>(userId, 'home_brief') as SavedHomeBrief | null;
  if (saved?.context?.fingerprint === fingerprint && typeof saved.result === 'string' && saved.result) {
    return { state: 'ok', caption: saved.result, generatedAt: saved.createdAt, fresh: false };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { state: 'error', message: 'AI usage limits are not available right now.' };
  }
  const credit = await claimAiCredit((fn, args) => admin.rpc(fn, args), userId, 'home_brief', DAILY_BRIEF_LIMIT);
  if (credit === 'error') return { state: 'error', message: 'The brief can’t be written right now.' };
  if (credit === 'limit') return { state: 'error', message: 'Today’s AI requests are used up. The brief will write itself again tomorrow.' };

  // The same writer serves the push notification, and it routes through the
  // registry, so a snapshot of someone's spending only ever reaches a provider
  // whose row says it will not train on it.
  const written = await writeBrief(userId, snapshot, 'note');
  if (!written) return { state: 'error', message: 'No AI provider was available, so Orbis’s own wording is shown.' };

  const stamp = await saveAiResult({
    userId,
    feature: 'home_brief',
    result: written.caption,
    model: written.writtenBy,
    title: snapshotSummary(snapshot),
    context: { fingerprint, day: snapshot.today },
  });
  return { state: 'ok', caption: written.caption, generatedAt: stamp?.createdAt ?? new Date().toISOString(), fresh: true };
}
