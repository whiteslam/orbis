import 'server-only';

import { careerAiGate, parseResume, specFromText } from '@/lib/career/ai';
import { dedupeKey } from '@/lib/career/dedupe';
import { docxText, resumeKind } from '@/lib/career/docx-text';
import { draftApplication, MIN_TAILOR_MS } from '@/lib/career/drafting';
import { prefilter } from '@/lib/career/prefilter';
import { mergeProfiles } from '@/lib/career/profile';
import { runPool, withTimeout } from '@/lib/career/pool';
import { extractPdfText } from '@/lib/career/render/pdf-text';
import {
  CareerError, claimCareerRun, downloadCareerFile, getCareerRow, listApplications, listCareerUsers, listJobs,
  listJobsNeedingRequirements, listUnscoredJobs, releaseCareerRun, saveProfile, setLastIngest, setResumeFile, setSourceCursors,
  upsertJobs, type CareerDb, type CareerRow,
} from '@/lib/career/repository';
import { careerToday, needsRequirements, readableJob, scoreJob } from '@/lib/career/scoring';
import { sourcesDue, type SourceQuery } from '@/lib/career/sources';
import type { CareerJob, CareerProfile, CareerSpec, NormalizedJob, SourceId } from '@/lib/career/types';

// The job search, every 3 hours and on "Run a search now": fetch the sources
// that are due, save what's new, score it, and draft the best few. Each step
// watches the deadline, and whatever doesn't fit is carried to the next run.

export type IngestSummary = { found: number; scored: number; drafted: number };

/** New jobs drafted per run, best first. Each is a tailoring call and two files. */
export const AUTO_DRAFTS_PER_RUN = 3;
/** Jobs scored per run. Most fail the prefilter at no AI cost; the rest wait for the next run. */
const SCORE_CAP = 80;
const SCORE_LANES = 4;
// A source that hasn't answered in this long is left for the next run.
const SOURCE_TIMEOUT_MS = 15_000;
// The router may wait 1.5 × its timeout across models; a scoring task asks for 15 s.
const AI_SCORE_MS = 15_000;
const AI_TASK_MS = 24_000;
const QUICK_TASK_MS = 1_500;
// Only recent matches are worth a draft nobody asked for.
const DRAFT_WINDOW_DAYS = 7;
const DRAFT_TASK_MS = MIN_TAILOR_MS + 10_000;
/** The cron runs every 3 hours; a run claimed less than this ago is still someone else's. */
const CLAIM_STALE_MS = 150 * 60_000;
const DAY_MS = 86_400_000;

type Profiled = CareerRow & { profile: CareerProfile; spec: CareerSpec };

const isProfiled = (row: CareerRow | null): row is Profiled => Boolean(row?.profile && row.spec);

/**
 * A manual run ignores each source's interval, except Remotive's four-a-day
 * limit, which is in its terms; only that cursor is kept.
 */
function cursorsFor(row: CareerRow, manual: boolean): Record<string, string> {
  const cursors = row.sourceCursors as Record<string, string>;
  if (!manual) return cursors;
  return cursors.remotive ? { remotive: cursors.remotive } : {};
}

async function fetchDue(row: Profiled, manual: boolean, deadline: number): Promise<{ jobs: NormalizedJob[]; sources: SourceId[] }> {
  const timeout = Math.min(SOURCE_TIMEOUT_MS, deadline - Date.now() - 10_000);
  if (timeout < 3_000) return { jobs: [], sources: [] };
  const due = sourcesDue(cursorsFor(row, manual), new Date(), row.settings.sources, process.env);
  const query: SourceQuery = { roles: row.spec.roles, countries: row.settings.adzunaCountries, watchlist: row.settings.watchlist, env: process.env };
  const lists = await Promise.all(due.map((source) => withTimeout(source.fetch(query), timeout, [])));
  return { jobs: lists.flat(), sources: due.map((source) => source.id) };
}

/** Whether scoring this job will call a model: in the owner's roles, a full listing, requirements missing or stale. */
function scoringNeedsAi(job: CareerJob, row: Profiled): boolean {
  return readableJob(job) && needsRequirements(job) && prefilter(job, row.spec, row.settings).pass;
}

/** Unscored jobs, newest first, then full listings that were scored before their requirements could be read. */
async function scoringQueue(client: CareerDb, userId: string): Promise<CareerJob[]> {
  const unscored = await listUnscoredJobs(client, userId, SCORE_CAP);
  if (unscored.length >= SCORE_CAP) return unscored;
  const seen = new Set(unscored.map((job) => job.id));
  const retry = (await listJobsNeedingRequirements(client, userId, SCORE_CAP - unscored.length))
    .filter((job) => !seen.has(job.id) && readableJob(job) && (job.score ?? 1) > 0);
  return [...unscored, ...retry];
}

/** Scores what the queue holds: the quick ones first, then the ones that need a model, a few at a time. */
async function scoreQueued(client: CareerDb, userId: string, row: Profiled, deadline: number): Promise<number> {
  const queue = await scoringQueue(client, userId);
  const today = careerToday();
  const score = (job: CareerJob) => scoreJob(client, userId, job, row.profile, row.spec, row.settings, {
    today, timeoutMs: Math.min(AI_SCORE_MS, deadline - Date.now() - 2_000),
  });
  const slow = queue.filter((job) => scoringNeedsAi(job, row));
  const quick = queue.filter((job) => !slow.includes(job));
  const first = await runPool(quick, score, { limit: SCORE_LANES, deadline, taskMs: QUICK_TASK_MS });
  const second = await runPool(slow, score, { limit: SCORE_LANES, deadline, taskMs: AI_TASK_MS });
  return first.results.length + second.results.length;
}

/** For-you jobs from the last week with a full listing and read requirements, and no application yet. */
async function draftCandidates(client: CareerDb, userId: string, row: Profiled): Promise<CareerJob[]> {
  const [matches, applications] = await Promise.all([
    listJobs(userId, { view: 'for_you', threshold: row.settings.threshold, limit: 30 }, client),
    listApplications(userId, { limit: 1000 }, client),
  ]);
  const applied = new Set(applications.map((app) => app.jobId));
  const since = Date.now() - DRAFT_WINDOW_DAYS * DAY_MS;
  // Thin jobs are never auto-drafted: the owner is asked for the full description first.
  return matches.filter((job) => !applied.has(job.id) && readableJob(job) && job.requirements !== null
    && job.match?.confidence === 'high' && Date.parse(job.foundAt) >= since);
}

async function autoDraft(client: CareerDb, userId: string, row: Profiled, deadline: number): Promise<number> {
  if (deadline - Date.now() < DRAFT_TASK_MS || (await careerAiGate(userId))) return 0;
  let drafted = 0;
  for (const job of (await draftCandidates(client, userId, row)).slice(0, AUTO_DRAFTS_PER_RUN)) {
    if (deadline - Date.now() < DRAFT_TASK_MS) break;
    // One at a time: each draft is given whatever time the previous one left.
    const outcome = await draftApplication(client, userId, job.id, { deadline }); // NOSONAR: drafts share one time budget, so they run in turn
    if (outcome.ok) drafted += 1;
  }
  return drafted;
}

/**
 * One person's search: fetch, save, score, draft. `client` must be the admin
 * client: the cursors and last-run time are service-role columns. `manual`
 * is "Run a search now", which ignores the sources' intervals (Remotive's
 * limit aside).
 */
export async function ingestUser(client: CareerDb, userId: string, options: { deadline: number; manual: boolean }): Promise<IngestSummary> {
  const row = await getCareerRow(userId, client);
  if (!isProfiled(row)) return { found: 0, scored: 0, drafted: 0 };
  const { jobs, sources } = await fetchDue(row, options.manual, options.deadline);
  const found = await upsertJobs(client, userId, jobs.map((job) => ({ ...job, dedupeKey: dedupeKey(job) })));
  await setSourceCursors(client, userId, sources);
  const scored = await scoreQueued(client, userId, row, options.deadline);
  const drafted = await autoDraft(client, userId, row, options.deadline);
  await setLastIngest(client, userId);
  return { found: found.length, scored, drafted };
}

export type IngestRunSummary = IngestSummary & { users: number; failed: number };

/** Everyone due, longest-waiting first, until the deadline. The rest are picked up by the next run. */
export async function ingestDue(admin: CareerDb, now: Date, deadline: number): Promise<IngestRunSummary> {
  const summary: IngestRunSummary = { users: 0, failed: 0, found: 0, scored: 0, drafted: 0 };
  const staleBefore = new Date(now.getTime() - CLAIM_STALE_MS).toISOString();
  for (const person of await listCareerUsers(admin, 'ingest')) {
    if (deadline - Date.now() < SOURCE_TIMEOUT_MS) break;
    // Claim first, so an overlapping run skips this person.
    if (!(await claimCareerRun(admin, person.userId, 'ingest', now.toISOString(), staleBefore))) continue; // NOSONAR: one person at a time, so the run stops cleanly at the deadline
    try {
      const result = await ingestUser(admin, person.userId, { deadline, manual: false }); // NOSONAR: as above
      summary.users += 1;
      summary.found += result.found;
      summary.scored += result.scored;
      summary.drafted += result.drafted;
    } catch (error) {
      console.error('Career ingest failed for a person', error);
      summary.failed += 1;
      // Give the run back, so the next cron tries again rather than in three hours.
      await releaseCareerRun(admin, person.userId, 'ingest', person.lastIngestAt).catch(() => undefined); // NOSONAR: as above
    }
  }
  return summary;
}

// ─── Resume and spec ──────────────────────────────────────────────────────

export type ResumeOutcome = { ok: true; profile: CareerProfile } | { ok: false; message: string };

const UNREADABLE = 'That file has no text Orbis can read. If it’s a scanned PDF, export it again from Word or Google Docs.';
// Less than this isn't a resume, whatever the file says.
const MIN_RESUME_CHARS = 150;

async function resumeText(bytes: Uint8Array, kind: 'pdf' | 'docx'): Promise<string> {
  const text = kind === 'pdf' ? (await extractPdfText(bytes)).text : docxText(bytes);
  return text?.trim() ?? '';
}

/** Why AI can't read `what` right now, or null when it can. */
function aiMessage(blocked: Awaited<ReturnType<typeof careerAiGate>>, what: string): string | null {
  if (blocked === 'off') return `Turn on AI in Settings so Orbis can read ${what}.`;
  if (blocked === 'unavailable') return `No AI model can read ${what} right now. Try again in a little while.`;
  return null;
}

/**
 * Reads an uploaded resume (PDF or DOCX) into the profile. The file and its
 * text are kept first, so the resume stays on file even if reading it fails.
 * A re-upload merges: facts the owner confirmed or edited are never dropped.
 */
export async function processResume(client: CareerDb, userId: string, path: string, fileName: string): Promise<ResumeOutcome> {
  try {
    const bytes = await downloadCareerFile(userId, path, client);
    const kind = resumeKind(bytes);
    if (!kind) return { ok: false, message: 'Upload your resume as a PDF or a Word (.docx) file.' };
    const text = await resumeText(bytes, kind);
    await setResumeFile(userId, { path, name: fileName, text: text || null }, client);
    if (text.length < MIN_RESUME_CHARS) return { ok: false, message: UNREADABLE };
    const blocked = aiMessage(await careerAiGate(userId), 'your resume');
    if (blocked) return { ok: false, message: blocked };
    const parsed = await parseResume(userId, text);
    if (!parsed) return { ok: false, message: 'Your resume couldn’t be read just now. Try again in a little while.' };
    const existing = (await getCareerRow(userId, client))?.profile;
    const profile = existing ? mergeProfiles(existing, parsed) : parsed;
    await saveProfile(userId, profile, client);
    return { ok: true, profile };
  } catch (error) {
    if (error instanceof CareerError) return { ok: false, message: error.message };
    console.error('Reading a resume failed', error);
    return { ok: false, message: 'Your resume couldn’t be read just now. Try again in a little while.' };
  }
}

export type SpecOutcome = { ok: true; spec: CareerSpec } | { ok: false; message: string };

/**
 * "Senior React roles, remote, ₹40L+" as a spec for the owner to check and
 * save. Not saved here: Setup shows it back first. Reads with the session.
 */
export async function specFromSentence(userId: string, sentence: string): Promise<SpecOutcome> {
  const text = sentence.trim().slice(0, 2000);
  if (text.length < 3) return { ok: false, message: 'Say in a sentence what you’re looking for.' };
  const blocked = aiMessage(await careerAiGate(userId), 'that');
  if (blocked) return { ok: false, message: blocked };
  try {
    const profile = (await getCareerRow(userId))?.profile ?? null;
    const spec = await specFromText(userId, text, profile);
    return spec ? { ok: true, spec } : { ok: false, message: 'That couldn’t be turned into a search just now. Try again, or fill in the fields.' };
  } catch (error) {
    if (error instanceof CareerError) return { ok: false, message: error.message };
    console.error('Reading a spec sentence failed', error);
    return { ok: false, message: 'That couldn’t be turned into a search just now. Try again, or fill in the fields.' };
  }
}
