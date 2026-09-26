'use server';

import { revalidatePath } from 'next/cache';
import { getAiPreferences, setHomeBriefEnabled } from '@/lib/ai/preferences';
import { getLatestAiResult, saveAiResult } from '@/lib/ai/results';
import type { SavedHomeBrief } from '@/lib/ai/saved';
import { briefSnapshot, snapshotFingerprint, snapshotSummary } from '@/lib/home/ai-brief';
import { writeBrief } from '@/lib/brief/compose';
import { getFinanceSummary } from '@/lib/finance/repository';
import { getHealthLibrary } from '@/lib/health-docs/repository';
import { getPersonalProfile } from '@/lib/personal/repository';
import { getRoutinesSummary } from '@/lib/routines/repository';
import { currentRoutine, missedRoutines, routinesToday } from '@/lib/routines/today';
import { clockLabel } from '@/lib/routines/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { APP_LOCK_MESSAGE, isAppUnlocked } from '@/lib/security/app-lock';

// The brief regenerates on a data change, not on every visit, so this ceiling is
// only reached by a genuinely busy day. It is separate from the workbook and
// portfolio budget: a background brief must never eat a request the user wanted
// to spend on asking a question.
const DAILY_BRIEF_LIMIT = 12;

export type BriefResult =
  | { state: 'ok'; caption: string; generatedAt: string; fresh: boolean }
  | { state: 'off' }
  | { state: 'error'; message: string };

async function authed() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== 'string') return null;
  if (!(await isAppUnlocked(data?.claims))) return null;
  return { supabase, userId };
}

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
    // The hour is what makes a forecast quotable; a probability without one is dropped.
    rainPeak: peak && typeof peak.probability === 'number' && Number.isFinite(peak.probability) && typeof peak.hour === 'string'
      ? { probability: Math.round(Math.max(0, Math.min(100, peak.probability))), hour: peak.hour.slice(0, 12) }
      : null,
  };
}

/**
 * Returns the brief for today's data: the saved one when it was written about
 * exactly this snapshot, a freshly generated one otherwise.
 *
 * The snapshot is rebuilt here from the database rather than taken from the
 * page, so what reaches the model is always what Orbis actually holds.
 */
export async function loadHomeBriefAction(input: unknown): Promise<BriefResult> {
  const auth = await authed();
  if (!auth) return { state: 'error', message: APP_LOCK_MESSAGE };

  const preferences = await getAiPreferences(auth.userId);
  if (!preferences.homeBriefEnabled) return { state: 'off' };
  if (!preferences.configured) return { state: 'error', message: 'No AI provider that can hold personal data is configured on this server.' };

  const [finance, library, profile, routines] = await Promise.all([
    getFinanceSummary(auth.userId),
    getHealthLibrary(auth.userId),
    getPersonalProfile(auth.userId),
    getRoutinesSummary(auth.userId),
  ]);

  const due = routinesToday(routines, new Date());
  const current = currentRoutine(due);

  const snapshot = briefSnapshot({
    finance,
    documentCount: library.documents.length,
    name: profile.profile?.preferredName ?? null,
    routine: current
      ? {
        title: current.routine.title,
        kind: current.routine.kind,
        at: clockLabel(current.routine.atTime),
        minutesAway: current.minutesAway,
        answered: current.event ? current.event.note ?? current.event.status : null,
      }
      : null,
    missedCount: missedRoutines(due).length,
    weather: readWeather((input as { weather?: unknown })?.weather),
  });
  const fingerprint = snapshotFingerprint(snapshot);

  // A brief already written about these exact numbers is still true.
  const saved = await getLatestAiResult<string, { fingerprint?: string }>(auth.userId, 'home_brief') as SavedHomeBrief | null;
  if (saved?.context?.fingerprint === fingerprint && typeof saved.result === 'string' && saved.result) {
    return { state: 'ok', caption: saved.result, generatedAt: saved.createdAt, fresh: false };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
    const { data: allowed, error } = await admin.rpc('consume_workbook_ai_request', { p_user_id: auth.userId, p_daily_limit: DAILY_BRIEF_LIMIT });
    if (error) return { state: 'error', message: 'AI usage limits are not set up yet. Apply the workbook usage migration in Supabase.' };
    if (!allowed) return { state: 'error', message: 'Today’s AI requests are used up. The brief will write itself again tomorrow.' };
  } catch {
    return { state: 'error', message: 'AI usage limits are not available right now.' };
  }

  // The same writer serves the push notification, and it routes through the
  // registry, so a snapshot of someone's spending only ever reaches a provider
  // whose row says it will not train on it.
  const written = await writeBrief(auth.userId, snapshot, 'note');
  if (!written) return { state: 'error', message: 'No AI provider was available, so Orbis’s own wording is shown.' };

  const stamp = await saveAiResult({
    userId: auth.userId,
    feature: 'home_brief',
    result: written.caption,
    model: written.writtenBy,
    title: snapshotSummary(snapshot),
    context: { fingerprint, day: snapshot.today },
  });
  return { state: 'ok', caption: written.caption, generatedAt: stamp?.createdAt ?? new Date().toISOString(), fresh: true };
}

export async function setHomeBriefEnabledAction(enabled: unknown) {
  const auth = await authed();
  if (!auth) return { success: false, message: 'Sign in again to change this setting.' };
  if (typeof enabled !== 'boolean') return { success: false, message: 'That setting could not be saved.' };
  const result = await setHomeBriefEnabled(auth.userId, enabled);
  if (!result.ok) return { success: false, message: result.message };
  revalidatePath('/');
  return { success: true, message: enabled ? 'Orbis will write your brief from now on.' : 'The brief is back to Orbis’s own wording. Nothing is sent for it.' };
}
