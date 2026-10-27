import 'server-only';

import { freshnessDays, missingMust } from '@/lib/career/history';
import { buildInsights, replyDelays } from '@/lib/career/insights';
import { scoreMatch, withSkill } from '@/lib/career/match';
import { titleFitsRole } from '@/lib/career/prefilter';
import { normaliseSkill } from '@/lib/career/skills';
import { getCareerRow, listApplications, listEvents, listJobsByIds, listJobsSince, type CareerDb } from '@/lib/career/repository';
import type { CareerInsights, CareerJob, CareerProfile, CareerSettings, CareerSpec } from '@/lib/career/types';

// Insights' inputs, assembled from the record. The maths is all in
// lib/career/insights.ts; this only reads and shapes.

/** Jobs found in this window feed the market, salary and skill-gap cards (the market chart shows 8 weeks). */
const WINDOW_DAYS = 60;
const MAX_JOBS = 2000;
const DAY_MS = 86_400_000;
// Stands in for the description, which the summary read leaves out: a job
// scored with high confidence had one, and scoreMatch only checks it exists.
const DESCRIBED = 'description on file';

type Rescorer = (jobId: string, skill: string) => number;

/**
 * "What if you had this skill": the job rescored with the skill added, at the
 * years the job asks for it, so a year-bound must-have can be met. Profiles
 * per skill and years are made once and reused across jobs.
 */
function rescorer(jobs: ReadonlyMap<string, CareerJob>, profile: CareerProfile, spec: CareerSpec, settings: CareerSettings, today: string): Rescorer {
  const profiles = new Map<string, CareerProfile>();
  const profileWith = (skill: string, years: number | null) => {
    const key = `${skill}|${years ?? ''}`;
    let found = profiles.get(key);
    if (!found) {
      found = withSkill(profile, skill, years);
      profiles.set(key, found);
    }
    return found;
  };
  return (jobId, skill) => {
    const job = jobs.get(jobId);
    if (!job?.requirements || job.match?.confidence !== 'high') return job?.score ?? 0;
    const name = normaliseSkill(skill);
    const asked = [...job.requirements.mustHave, ...job.requirements.niceToHave].find((item) => normaliseSkill(item.skill) === name);
    return scoreMatch({
      profile: profileWith(skill, asked?.years ?? null), spec, job: { ...job, description: DESCRIBED }, requirements: job.requirements, today, synonyms: settings.synonyms,
    }).score;
  };
}

/**
 * Everything the Insights view shows, or null before Career is set up.
 * `today` is the owner's 'YYYY-MM-DD'; `timeZone` places the best-day card.
 */
export async function loadInsights(client: CareerDb, userId: string, today: string, timeZone = 'Asia/Kolkata'): Promise<CareerInsights | null> {
  const row = await getCareerRow(userId, client);
  if (!row?.profile || !row.spec) return null;
  const { profile, spec, settings } = row;
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - WINDOW_DAYS * DAY_MS).toISOString();
  const [recent, applications, events] = await Promise.all([
    listJobsSince(userId, since, MAX_JOBS, client),
    listApplications(userId, { limit: 1000 }, client),
    listEvents(userId, { limit: 1000 }, client),
  ]);
  const jobs = new Map(recent.map((job) => [job.id, job]));
  // Applications to jobs found before the window still count for the funnel and freshness.
  const older = applications.filter((app) => !jobs.has(app.jobId)).map((app) => app.jobId);
  for (const job of older.length ? await listJobsByIds(userId, older, client) : []) jobs.set(job.id, job);

  return buildInsights({
    today,
    threshold: settings.threshold,
    timeZone,
    jobs: recent.map((job) => ({
      id: job.id, source: job.source, title: job.title, score: job.score, foundAt: job.foundAt, salary: job.salary, missingMust: missingMust(job),
    })),
    applications: applications.map((app) => ({
      jobId: app.jobId, status: app.status, sentAt: app.sentAt, prediction: app.prediction,
      freshnessDays: freshnessDays(jobs.get(app.jobId)?.postedAt ?? null, app.sentAt),
    })),
    events,
    replyDelayDays: replyDelays(applications, events),
    rescoreWith: rescorer(jobs, profile, spec, settings, today),
    roleMatch: (title) => spec.roles.some((role) => titleFitsRole(title, role, settings.synonyms)),
  });
}
