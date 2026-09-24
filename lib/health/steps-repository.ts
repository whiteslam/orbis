import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { stepStats } from '@/lib/health/steps-stats';
import type { StepsSummary } from '@/lib/health/types';

const emptySummary = { days: [], latest: null, average7: null, average30: null, previous30: null, best: null, lastImport: null };

export async function getStepsSummary(userId: string): Promise<StepsSummary> {
  const supabase = await createClient();
  const [steps, batch] = await Promise.all([
    supabase.from('health_daily_steps').select('date,steps').eq('user_id', userId).order('date', { ascending: false }).limit(120),
    supabase.from('health_import_batches').select('created_at,last_date').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const error = steps.error ?? batch.error;
  if (error) {
    const missing = ['PGRST205', 'PGRST204', '42P01'].includes(error.code ?? '');
    return { databaseReady: !missing, loadError: !missing, ...emptySummary };
  }

  const days = (steps.data ?? []).map((day) => ({ date: day.date, steps: Number(day.steps) })).reverse();
  const stats = stepStats(days);
  return {
    databaseReady: true,
    loadError: false,
    days: days.slice(-90),
    latest: stats.latest,
    average7: stats.average7,
    average30: stats.average30,
    previous30: stats.previous30,
    best: stats.best,
    lastImport: batch.data ? { importedAt: batch.data.created_at, lastDate: batch.data.last_date } : null,
  };
}
