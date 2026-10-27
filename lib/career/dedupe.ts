/**
 * Career: one job, however many boards list it. Client-safe and pure.
 *
 * The key is company | title | place, each normalised, so the same opening
 * from Remotive and a LinkedIn alert lands on one row (design: Pipeline → Dedupe).
 */
import type { NormalizedJob } from './types.ts';
import { locationBucket, normaliseCompany, normaliseTitle } from './normalise.ts';

export function dedupeKey(job: NormalizedJob): string {
  return `${normaliseCompany(job.company)}|${normaliseTitle(job.title)}|${locationBucket(job.location, job.remote)}`;
}

/** How much a listing tells us: a full description beats a thin alert, then longer beats shorter. */
function richness(job: NormalizedJob) {
  return (job.thin ? 0 : 1_000_000) + (job.description?.length ?? 0);
}

/** How much a salary tells us: both ends beat one end beats none. */
function salaryDetail(salary: NormalizedJob['salary']) {
  if (!salary) return 0;
  return (salary.min === null ? 0 : 1) + (salary.max === null ? 0 : 1);
}

/**
 * The two sightings merged: the richer description (and its source, URL and
 * title) wins, and each gap in it is filled from the other: salary, apply
 * email, apply URL, posting date, Recruitee coordinates.
 */
export function richerJob(a: NormalizedJob, b: NormalizedJob): NormalizedJob {
  const [base, other] = richness(b) > richness(a) ? [b, a] : [a, b];
  const recruitee = base.recruitee ?? other.recruitee;
  return {
    ...base,
    salary: salaryDetail(other.salary) > salaryDetail(base.salary) ? other.salary : base.salary,
    applyEmail: base.applyEmail ?? other.applyEmail,
    applyUrl: base.applyUrl ?? other.applyUrl,
    location: base.location ?? other.location,
    postedAt: earlier(base.postedAt, other.postedAt),
    // Either sighting knowing it's remote is enough.
    remote: base.remote || other.remote,
    thin: base.thin && other.thin,
    ...(recruitee ? { recruitee } : {}),
  };
}

/** The first posting date is the true age of the opening. */
function earlier(a: string | null, b: string | null) {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}
