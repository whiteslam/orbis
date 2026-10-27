/**
 * The small decisions drafting makes that don't need a database. Pure.
 */
import type { ApplicationStatus, ApplyRoute, CareerJob, Requirements } from './types.ts';

/** More than a third of the bullets failing the truth check means the draft is rewritten once. */
export const REGENERATE_ABOVE = 1 / 3;

/**
 * How the application leaves Orbis: by email when there is an address to apply
 * to, through Recruitee's API for a Recruitee listing, otherwise the owner
 * applies on the site with everything ready to paste.
 */
export function applyRouteFor(job: Pick<CareerJob, 'applyEmail' | 'recruitee'>, requirements: Pick<Requirements, 'applyEmail'> | null): ApplyRoute {
  if (job.applyEmail ?? requirements?.applyEmail) return 'email';
  if (job.recruitee) return 'recruitee';
  return 'link';
}

/** The address to apply to, from the listing or, failing that, from what the description says. */
export function applyEmailFor(job: Pick<CareerJob, 'applyEmail'>, requirements: Pick<Requirements, 'applyEmail'> | null): string | null {
  return job.applyEmail ?? requirements?.applyEmail ?? null;
}

const VERSION = /resume-(\d+)\.(?:pdf|docx)$/;

/** The next file version after the stored one, so a redraft never serves a cached old file. */
export function nextFileVersion(previousPath: string | null): number {
  const match = previousPath ? VERSION.exec(previousPath) : null;
  return match ? Number.parseInt(match[1], 10) + 1 : 1;
}

/** Statuses a draft may be (re)made from: before anything was sent. */
export const REDRAFTABLE: readonly ApplicationStatus[] = ['drafting', 'ready', 'failed'];

/** Why a job can't be drafted yet, in the owner's words, or null when it can. */
export function draftBlocker(job: Pick<CareerJob, 'thin' | 'description'>, existing: { status: ApplicationStatus } | null): string | null {
  if (existing && !REDRAFTABLE.includes(existing.status)) return 'This job already has an application on its way.';
  if (job.thin || !job.description?.trim()) {
    return 'This listing only has a title and a line. Paste the full job description first, then draft it.';
  }
  return null;
}

/** Which of two truth-checked attempts to keep: the one that lost fewer bullets; the first on a tie. */
export function betterAttempt<T extends { failedShare: number }>(first: T, second: T | null): T {
  return second && second.failedShare < first.failedShare ? second : first;
}
