import 'server-only';

import { careerAiGate, tailorApplication } from '@/lib/career/ai';
import { atsCheck } from '@/lib/career/ats';
import { applyEmailFor, applyRouteFor, betterAttempt, draftBlocker, nextFileVersion, REGENERATE_ABOVE } from '@/lib/career/draft-plan';
import { outcomesOf } from '@/lib/career/history';
import { companyDomains } from '@/lib/career/mail';
import { scoreMatch } from '@/lib/career/match';
import { predictApplication, train } from '@/lib/career/predict';
import { renderResumeDocx } from '@/lib/career/render/docx';
import { resumeSections } from '@/lib/career/render/layout';
import { renderResumePdf } from '@/lib/career/render/pdf';
import { extractPdfText } from '@/lib/career/render/pdf-text';
import {
  addEvent, applicationFilePath, CareerError, createApplication, getApplicationFiles, getApplicationForJob, getCareerRow, getJob,
  listApplications, listEvents, listJobsByIds, updateApplication, uploadCareerFile, type CareerDb,
} from '@/lib/career/repository';
import { careerToday, ensureRequirements } from '@/lib/career/scoring';
import { mergeAnswers, type TailorInput } from '@/lib/career/tailor';
import { checkTailored, type TruthResult } from '@/lib/career/truth';
import type {
  ApplyRoute, AtsReport, CareerApplication, CareerJob, CareerProfile, CareerSpec, Prediction, Requirements, TailoredDraft,
} from '@/lib/career/types';

export { redraftText, type RedraftInput, type RedraftResult } from '@/lib/career/redraft';

// Drafting one application: tailor, truth check, render, ATS check, store. The
// owner sees nothing the truth check didn't pass, and nothing leaves Orbis
// until they press Send (that's the send action, not this).

export type DraftOutcome = { ok: true; applicationId: string } | { ok: false; message: string };

export type DraftOptions = {
  /** Epoch ms the caller must be done by (a cron's budget); the model's wait is cut to fit. */
  deadline?: number;
  today?: string;
};

const PDF_TYPE = 'application/pdf';
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// Rendering both files, reading the PDF back and uploading take a few seconds.
const RENDER_RESERVE_MS = 8_000;
const TAILOR_MAX_MS = 40_000;
/** Less than this for the model, and a draft isn't worth starting. */
export const MIN_TAILOR_MS = 15_000;

const AI_OFF = 'Turn on AI in Settings to draft applications.';
const AI_UNAVAILABLE = 'No AI model can draft right now. Try again in a little while.';
const NOT_WRITTEN = 'The tailored resume couldn’t be written. Try again in a little while.';
const NO_REQUIREMENTS = 'This job’s requirements couldn’t be read yet. Try again in a little while.';
const NOT_RENDERED = 'The resume files couldn’t be made. Try again in a little while.';

/** A failure whose message is the owner's to read. */
class DraftFailure extends Error {}

function tailorTimeout(options: DraftOptions): number {
  if (!options.deadline) return TAILOR_MAX_MS;
  return Math.min(TAILOR_MAX_MS, options.deadline - Date.now() - RENDER_RESERVE_MS);
}

type Context = { job: CareerJob; profile: CareerProfile; spec: CareerSpec; synonyms: string[][] };

async function loadContext(client: CareerDb, userId: string, jobId: string): Promise<Context> {
  const [job, row] = await Promise.all([getJob(userId, jobId, client), getCareerRow(userId, client)]);
  if (!job) throw new DraftFailure('That job couldn’t be found.');
  if (!row?.profile || !row.spec) throw new DraftFailure('Add your resume and say what you’re looking for first.');
  return { job, profile: row.profile, spec: row.spec, synonyms: row.settings.synonyms };
}

async function aiReady(userId: string) {
  const blocked = await careerAiGate(userId);
  if (blocked === 'off') throw new DraftFailure(AI_OFF);
  if (blocked === 'unavailable') throw new DraftFailure(AI_UNAVAILABLE);
}

/** The job's application, created or set back to drafting. */
async function startApplication(client: CareerDb, userId: string, job: CareerJob): Promise<CareerApplication> {
  const existing = await getApplicationForJob(userId, job.id, client);
  const blocker = draftBlocker(job, existing);
  if (blocker) throw new DraftFailure(blocker);
  if (!existing) return createApplication(userId, { jobId: job.id, route: applyRouteFor(job, job.requirements), status: 'drafting' }, client);
  return (await updateApplication(userId, existing.id, { status: 'drafting' }, client)) ?? existing;
}

async function tailorOnce(userId: string, input: TailorInput, options: DraftOptions): Promise<TruthResult | null> {
  const timeoutMs = tailorTimeout(options);
  if (timeoutMs < MIN_TAILOR_MS) return null;
  const reply = await tailorApplication(userId, input, { timeoutMs });
  if (!reply) return null;
  // The target company and role must be named in the job, or the check strips them as unknown organisations.
  return checkTailored({ ...reply, profile: input.profile, requirements: input.requirements, job: { company: input.job.company, title: input.job.title } });
}

/** Tailor and check; if more than a third of the bullets fail, once more, keeping the better attempt. */
async function tailorChecked(userId: string, input: TailorInput, options: DraftOptions): Promise<TruthResult> {
  const first = await tailorOnce(userId, input, options);
  if (!first) throw new DraftFailure(NOT_WRITTEN);
  if (first.failedShare <= REGENERATE_ABOVE) return first;
  return betterAttempt(first, await tailorOnce(userId, input, options));
}

export type RenderedFiles = { pdfPath: string; docxPath: string; ats: AtsReport };

/**
 * Renders the resume (PDF and DOCX), reads the PDF back for the ATS check and
 * stores both under a new version. Exported so an owner's edit can re-render.
 */
export async function renderAndStore(
  client: CareerDb,
  userId: string,
  input: { applicationId: string; profile: CareerProfile; draft: TailoredDraft; requirements: Requirements | null },
): Promise<RenderedFiles> {
  const doc = resumeSections(input.profile, input.draft);
  const [pdf, docx, files] = await Promise.all([renderResumePdf(doc), renderResumeDocx(doc), getApplicationFiles(userId, input.applicationId, client)]);
  const { text, pages } = await extractPdfText(pdf);
  const ats = atsCheck({ text, pages, profile: input.profile, requirements: input.requirements });
  const version = Math.max(nextFileVersion(files?.pdfPath ?? null), nextFileVersion(files?.docxPath ?? null));
  const pdfPath = applicationFilePath(userId, input.applicationId, version, 'pdf');
  const docxPath = applicationFilePath(userId, input.applicationId, version, 'docx');
  await Promise.all([uploadCareerFile(client, userId, pdfPath, pdf, PDF_TYPE), uploadCareerFile(client, userId, docxPath, docx, DOCX_TYPE)]);
  return { pdfPath, docxPath, ats };
}

/**
 * The reply and interview chances for this application, from a model trained
 * on the owner's own resolved applications (the prior until there are 15).
 * Computed fresh each time: the record changes with every reply.
 */
export async function predictionFor(
  client: CareerDb,
  userId: string,
  input: { job: CareerJob; route: ApplyRoute; score: number; spec: CareerSpec; today: string },
): Promise<Prediction> {
  const [applications, events] = await Promise.all([
    listApplications(userId, {}, client),
    listEvents(userId, { limit: 1000 }, client),
  ]);
  const sent = applications.filter((app) => app.sentAt !== null);
  const jobs = await listJobsByIds(userId, sent.map((app) => app.jobId), client);
  const interviewed = new Set(events.flatMap((event) => (event.kind === 'interview_invite' && event.applicationId ? [event.applicationId] : [])));
  const model = train(outcomesOf(sent, new Map(jobs.map((job) => [job.id, job])), input.spec, interviewed));
  return predictApplication({ route: input.route, score: input.score, job: input.job, spec: input.spec, appliedAt: input.today }, model);
}

async function draftInto(client: CareerDb, userId: string, application: CareerApplication, context: Context, options: DraftOptions) {
  const { job, profile, spec } = context;
  const today = options.today ?? careerToday();
  const requirements = await ensureRequirements(client, userId, job, { timeoutMs: 20_000 });
  if (!requirements) throw new DraftFailure(NO_REQUIREMENTS);
  const match = scoreMatch({ profile, spec, job, requirements, today, synonyms: context.synonyms });
  const checked = await tailorChecked(userId, { profile, spec, job, requirements, match }, options);
  // Profile answers (notice, salary, years) replace the model's after the truth check, so they are never removed.
  const answers = mergeAnswers({ profile, spec, requirements, today, ai: checked.answers });
  let files: RenderedFiles;
  try {
    files = await renderAndStore(client, userId, { applicationId: application.id, profile, draft: checked.draft, requirements });
  } catch (error) {
    if (error instanceof CareerError) throw new DraftFailure(error.message);
    console.error('Rendering a tailored resume failed', error);
    throw new DraftFailure(NOT_RENDERED);
  }
  const route = applyRouteFor(job, requirements);
  const prediction = await predictionFor(client, userId, { job, route, score: job.score ?? match.score, spec, today });
  const domains = companyDomains({ applyEmail: applyEmailFor(job, requirements), urls: [job.url, job.applyUrl, ...job.seenOn.map((seen) => seen.url)] });
  await updateApplication(userId, application.id, {
    status: 'ready', route, draft: checked.draft, coverNote: checked.coverNote, answers, outreach: checked.outreach || null,
    removed: checked.removed, ats: files.ats, pdfPath: files.pdfPath, docxPath: files.docxPath, companyDomains: domains.slice(0, 20), prediction,
  }, client);
}

/** Leaves the application failed, with a timeline note saying why. Never throws: the owner's message matters more. */
async function markFailed(client: CareerDb, userId: string, applicationId: string, message: string) {
  try {
    await updateApplication(userId, applicationId, { status: 'failed' }, client);
    await addEvent(userId, { applicationId, kind: 'note', summary: `Drafting stopped: ${message}` }, client);
  } catch (error) {
    console.error('Marking a draft failed did not save', error);
  }
}

function messageOf(error: unknown): string {
  if (error instanceof DraftFailure || error instanceof CareerError) return error.message;
  console.error('Drafting an application failed', error);
  return NOT_WRITTEN;
}

/**
 * Drafts (or redrafts) the application for one job and leaves it `ready` in
 * the Queue. On any failure it is left `failed` with a note, and the message
 * says what to do.
 */
export async function draftApplication(client: CareerDb, userId: string, jobId: string, options: DraftOptions = {}): Promise<DraftOutcome> {
  let application: CareerApplication | null = null;
  try {
    const context = await loadContext(client, userId, jobId);
    await aiReady(userId);
    application = await startApplication(client, userId, context.job);
    await draftInto(client, userId, application, context, options);
    return { ok: true, applicationId: application.id };
  } catch (error) {
    const message = messageOf(error);
    if (application) await markFailed(client, userId, application.id, message);
    return { ok: false, message };
  }
}
