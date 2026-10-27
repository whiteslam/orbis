/**
 * What the owner's own record says: which applications are resolved and how
 * they went, for the prediction model and Insights. Pure.
 */
import type { ApplicationStatus, CareerApplication, CareerJob, CareerSpec } from './types.ts';
import { daysBetween } from './followup.ts';
import { featuresOf, type Outcome } from './predict.ts';
import { hadReply, stageRank } from './status.ts';

/** Reached an interview: interview or offer now, or closed after an offer. */
export function reachedInterview(status: ApplicationStatus): boolean {
  return stageRank(status) >= stageRank('interview') || status === 'accepted' || status === 'declined';
}

/** Sent, and its outcome is known: an answer of any kind, or long enough silence to be ghosted. */
export function isResolved(app: Pick<CareerApplication, 'status' | 'sentAt'>): boolean {
  return app.sentAt !== null && (hadReply(app.status) || app.status === 'ghosted');
}

/** Days from posting to sending; null when either is unknown. Never negative. */
export function freshnessDays(postedAt: string | null, sentAt: string | null): number | null {
  if (!postedAt || !sentAt) return null;
  return Math.max(0, daysBetween(postedAt, sentAt));
}

/**
 * The model's training rows: every resolved application whose job is known.
 * `interviewedIds` adds applications that had an interview invite but have
 * since been rejected, which the status alone no longer shows.
 */
export function outcomesOf(
  applications: ReadonlyArray<Pick<CareerApplication, 'id' | 'jobId' | 'status' | 'sentAt' | 'route'>>,
  jobsById: ReadonlyMap<string, Pick<CareerJob, 'score' | 'postedAt' | 'thin' | 'salary' | 'requirements'>>,
  spec: Pick<CareerSpec, 'salaryFloor' | 'salaryTarget' | 'seniority'>,
  interviewedIds: ReadonlySet<string> = new Set(),
): Outcome[] {
  const out: Outcome[] = [];
  for (const app of applications) {
    const job = jobsById.get(app.jobId);
    if (!job || !app.sentAt || !isResolved(app)) continue;
    out.push({
      features: featuresOf({ route: app.route, score: job.score ?? 0, job, spec, appliedAt: app.sentAt }),
      replied: hadReply(app.status),
      interviewed: reachedInterview(app.status) || interviewedIds.has(app.id),
    });
  }
  return out;
}

/** The must-have skills a job's match found missing, for the skill-gap radar. */
export function missingMust(job: Pick<CareerJob, 'match'>): string[] {
  return (job.match?.lines ?? []).filter((line) => line.kind === 'must' && line.verdict === 'missing').map((line) => line.requirement.skill);
}
