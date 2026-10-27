import 'server-only';

import { localClock } from '@/lib/notifications/schedule';
import { extractRequirements, type AiOptions } from '@/lib/career/ai';
import { scoreMatch } from '@/lib/career/match';
import { prefilter } from '@/lib/career/prefilter';
import { setJobMatch, setJobRequirements, type CareerDb } from '@/lib/career/repository';
import { REQUIREMENTS_VERSION } from '@/lib/career/requirements';
import type { CareerJob, CareerProfile, CareerSettings, CareerSpec, Requirements } from '@/lib/career/types';

/** The owner's calendar day, which is what "current role" and "years" are counted to. */
export function careerToday(now = new Date(), timeZone = 'Asia/Kolkata'): string {
  return localClock(now, timeZone).date;
}

/** Whether a job's stored requirements are missing or from an older prompt. */
export function needsRequirements(job: Pick<CareerJob, 'requirements'>): boolean {
  return !job.requirements || job.requirements.version < REQUIREMENTS_VERSION;
}

/** Only a full listing is worth sending to a model; a thin one has a title and a line. */
export function readableJob(job: Pick<CareerJob, 'thin' | 'description'>): boolean {
  return !job.thin && Boolean(job.description?.trim());
}

/**
 * The job's requirements, extracted and saved when missing or stale. Falls
 * back to whatever is stored (possibly null) when the job can't be read or no
 * model answers, so a scoring run never stalls on AI.
 */
export async function ensureRequirements(client: CareerDb, userId: string, job: CareerJob, options?: AiOptions): Promise<Requirements | null> {
  if (!needsRequirements(job) || !readableJob(job)) return job.requirements;
  const extracted = await extractRequirements(userId, job, options);
  if (!extracted) return job.requirements;
  await setJobRequirements(userId, job.id, extracted, client);
  return extracted;
}

export type ScoreOptions = AiOptions & { today?: string };

/**
 * Scores one job and saves it: the prefilter first (a job outside the owner's
 * roles is "not your role", scored 0, with no AI spent), then requirements if
 * they are missing or stale, then the deterministic match. Returns the score.
 */
export async function scoreJob(
  client: CareerDb,
  userId: string,
  job: CareerJob,
  profile: CareerProfile,
  spec: CareerSpec,
  settings: CareerSettings,
  options: ScoreOptions = {},
): Promise<number> {
  const gate = prefilter(job, spec, settings);
  if (!gate.pass) {
    await setJobMatch(userId, job.id, { score: 0, match: null, excluded: gate.reason ?? 'Not your role' }, client);
    return 0;
  }
  const requirements = await ensureRequirements(client, userId, job, options);
  const match = scoreMatch({ profile, spec, job, requirements, today: options.today ?? careerToday(), synonyms: settings.synonyms });
  await setJobMatch(userId, job.id, { score: match.score, match, excluded: match.excluded }, client);
  return match.score;
}
