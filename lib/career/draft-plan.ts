/**
 * The small decisions drafting makes that don't need a database. Pure.
 */
import { emailInText } from './requirements.ts';
import type { ApplicationStatus, ApplyRoute, CareerJob, Requirements } from './types.ts';

/** More than a third of the bullets failing the truth check means the draft is rewritten once. */
export const REGENERATE_ABOVE = 1 / 3;

/**
 * The address to apply to: the listing's own, or one the description gives.
 * An address the requirements model read counts only if it is written in the
 * description, so an injected or imagined one never becomes a recipient
 * (lib/career/requirements.ts checks this at parse time too; this covers
 * requirements stored before that check).
 */
export function applyEmailFor(job: Pick<CareerJob, 'applyEmail' | 'description'>, requirements: Pick<Requirements, 'applyEmail'> | null): string | null {
  if (job.applyEmail) return job.applyEmail;
  const read = requirements?.applyEmail ?? null;
  return read && emailInText(read, job.description) ? read : null;
}

/**
 * How the application leaves Orbis: by email when there is an address to apply
 * to, through Recruitee's API for a Recruitee listing, otherwise the owner
 * applies on the site with everything ready to paste.
 */
export function applyRouteFor(job: Pick<CareerJob, 'applyEmail' | 'description' | 'recruitee'>, requirements: Pick<Requirements, 'applyEmail'> | null): ApplyRoute {
  if (applyEmailFor(job, requirements)) return 'email';
  if (job.recruitee) return 'recruitee';
  return 'link';
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

/** What `auth.admin.getUserById` answered: a user, or an error with an HTTP status. */
export type OwnerLookup = { user: unknown; error: { status?: number } | null };

/**
 * Whether the owner is certainly gone (their account was deleted while a draft
 * was being made), so its files must not be written. Only a definite answer
 * counts: a lookup that failed for another reason lets the upload go ahead, and
 * account deletion's final storage sweep is the backstop.
 */
export function ownerGone(lookup: OwnerLookup): boolean {
  if (lookup.error) return lookup.error.status === 404;
  return !lookup.user;
}
