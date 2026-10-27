'use server';

// Career's server actions: the contract between the Career tab (and the web
// panel at /active/career) and lib/career. Every one checks the signed-in
// owner first and validates what the browser sent; the ones that run a model,
// send something or run a search are rate-limited, and AI ones check the AI
// gate before spending a rate-limit credit. Nothing here sends except the
// three Send actions, each of which is only ever a press of Send.
//
// /active and /active/career set `maxDuration = 60` for these: drafting and a
// manual search can take most of a minute.

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { isUuid } from '@/lib/validate/id';
import { UserFacingError } from '@/lib/errors';
import { AI_OFF_MESSAGE } from '@/lib/ai/consent';
import { rateLimitRefusal, type RateBucket } from '@/lib/security/rate-limit';
import { claimStaged, createUploadTarget, ALREADY_CLAIMED_MESSAGE } from '@/lib/storage/signed-upload';
import { CAREER_BUCKET, isCareerResumePath } from '@/lib/storage/upload-rules';
import { createAdminClient } from '@/lib/supabase/admin';
import { adviseOffer, careerAiGate } from '@/lib/career/ai';
import { trackerCsv } from '@/lib/career/csv';
import { dedupeKey } from '@/lib/career/dedupe';
import { draftApplication, redraftText, renderAndStore } from '@/lib/career/drafting';
import { cardJob, composeHome } from '@/lib/career/home';
import { ingestUser, processResume, specFromSentence } from '@/lib/career/ingest';
import { loadInsights } from '@/lib/career/insights-data';
import { validateTerms } from '@/lib/career/mail';
import { annualise, capCounter, type CompetingOffer } from '@/lib/career/offer';
import { totalYears, validateProfile } from '@/lib/career/profile';
import {
  addEvent, CareerError, countForYou, createOffer, findJobIdByKey, getApplication, getApplicationFiles, getApplicationForJob,
  getCareerRow, getCareerState, getJob, getOffer, linkEvent, listApplications, listEvents, listJobs, listJobsByIds, listJobsPage,
  listOffers, readSettings, saveProfile, saveSettings, saveSpec, sentAddresses, setJobDescription, setJobState, signedCareerUrl, transitionApplication,
  updateApplication, updateOffer, upsertJobs, type CareerDb, type CareerRow,
} from '@/lib/career/repository';
import { careerToday, scoreJob } from '@/lib/career/scoring';
import { buildPasteKit, resumeFileName } from '@/lib/career/send-plan';
import { applyRecipient } from '@/lib/career/recipient';
import { markApplied, offerTargetFor, sendApplication, sendFollowUp, sendOfferReply } from '@/lib/career/send';
import { fetchPastedJob, pastedUrlKind } from '@/lib/career/sources';
import { looksRemote } from '@/lib/career/sources/common';
import { validateSpec } from '@/lib/career/spec';
import { classifyAttached } from '@/lib/career/watch';
import { canTransition, ownerMoves, statusFromReply } from '@/lib/career/status';
import {
  APPLICATION_STATUSES, SOURCE_IDS,
  type ApplicationStatus, type CareerApplication, type CareerEvent, type CareerInsights, type CareerJob, type CareerProfile,
  type CareerSettings, type CareerSpec, type EventKind, type JobState, type NormalizedJob, type OfferAdvice, type OfferTerms,
  type ReplyClassification, type ReplyKind, type SourceId, type WatchedCompany,
} from '@/lib/career/types';
import type {
  ApplicationDetail, CareerHome, CareerSetup, DraftPatch, JobFilters, JobsPage, OwnerMove, ResumeUpload, Result, SendConfirmation, SendOutcome,
} from '@/lib/career/view';

// ─── Shared ───────────────────────────────────────────────────────────────

const SIGN_IN = { success: false as const, message: 'Sign in again to do this.' };
const INVALID = { success: false as const, message: 'That request isn’t valid. Reload and try again.' };
const SET_UP_FIRST = 'Add your resume and say what you’re looking for in Career → Setup first.';
const TIME_ZONE = 'Asia/Kolkata';
/** A manual search or a draft must finish inside the page's 60 s maxDuration. */
const ACTION_BUDGET_MS = 50_000;
const FILE_URL_SECONDS = 60 * 60;

const ok = <T,>(data: T): Result<T> => ({ success: true, data });
const fail = (message: string) => ({ success: false as const, message });

type Session = { userId: string; client: CareerDb };

async function session(): Promise<Session | null> {
  const signedIn = await requireUser();
  return signedIn ? { userId: signedIn.userId, client: signedIn.supabase } : null;
}

/** A message the owner can read: ours as written, anything else logged and replaced by `fallback`. */
function messageOf(error: unknown, fallback: string): string {
  if (error instanceof CareerError || error instanceof UserFacingError) return error.message;
  console.error(fallback, error);
  return fallback;
}

/** Runs `work` for the signed-in owner; anything it throws becomes a readable failure. */
async function signedIn<T>(fallback: string, work: (me: Session) => Promise<Result<T>>): Promise<Result<T>> {
  const me = await session();
  if (!me) return SIGN_IN;
  try {
    return await work(me);
  } catch (error) {
    return fail(messageOf(error, fallback));
  }
}

/** Why AI can't run for this owner now, or null. */
async function aiRefusal(userId: string): Promise<string | null> {
  const blocked = await careerAiGate(userId);
  if (blocked === 'off') return AI_OFF_MESSAGE;
  if (blocked === 'unavailable') return 'No AI model is available right now. Try again in a little while.';
  return null;
}

/** The AI gate, then one use of `bucket`: the first refusal, or null to go ahead. */
async function gateAndLimit(userId: string, bucket: RateBucket, needsAi: boolean): Promise<string | null> {
  if (needsAi) {
    const blocked = await aiRefusal(userId);
    if (blocked) return blocked;
  }
  return rateLimitRefusal(userId, bucket);
}

function refresh() {
  revalidatePath('/active');
  revalidatePath('/active/career');
}

/** A trimmed string within `max` characters, or null when it isn't one. */
function cleanText(value: unknown, max: number, min = 0): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length >= min && text.length <= max ? text : null;
}

const isOneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value);

const isWhole = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

const tooBig = (value: unknown, maxChars: number) => {
  try {
    return JSON.stringify(value).length > maxChars;
  } catch {
    return true;
  }
};

type Profiled = CareerRow & { profile: CareerProfile; spec: CareerSpec };
const isProfiled = (row: CareerRow | null): row is Profiled => Boolean(row?.profile && row.spec);

// ─── Detail ───────────────────────────────────────────────────────────────

async function signedFile(me: Session, path: string | null, name: string, format: 'pdf' | 'docx') {
  if (!path) return null;
  return signedCareerUrl(me.userId, path, { download: resumeFileName(name, format), seconds: FILE_URL_SECONDS }, me.client);
}

/** The job, its application, timeline, offer, signed file links, paste kit and where Send and the offer reply go. */
async function detailFor(me: Session, job: CareerJob, application: CareerApplication | null, row?: CareerRow | null): Promise<ApplicationDetail> {
  const emailRoute = application?.route === 'email';
  const [events, offers, files, careerRow, used] = await Promise.all([
    application ? listEvents(me.userId, { applicationId: application.id, limit: 200 }, me.client) : Promise.resolve([]),
    application ? listOffers(me.userId, { applicationId: application.id }, me.client) : Promise.resolve([]),
    application ? getApplicationFiles(me.userId, application.id, me.client) : Promise.resolve(null),
    row === undefined ? getCareerRow(me.userId, me.client) : Promise.resolve(row),
    emailRoute ? sentAddresses(me.userId, me.client) : Promise.resolve([]),
  ]);
  const offerTarget = application && offers.length ? offerTargetFor(application, job, events) : null;
  const name = careerRow?.profile?.contact.name ?? '';
  const [pdf, docx] = await Promise.all([
    signedFile(me, files?.pdfPath ?? null, name, 'pdf'),
    signedFile(me, files?.docxPath ?? null, name, 'docx'),
  ]);
  return {
    job,
    application,
    events,
    offer: offers[0] ?? null,
    files: { pdf, docx },
    pasteKit: buildPasteKit({ profile: careerRow?.profile ?? null, application, spec: careerRow?.spec ?? null }),
    recipient: application ? applyRecipient(job, application.route, used) : null,
    offerReplyTo: offerTarget ? { to: offerTarget.to, verified: offerTarget.verified } : null,
  };
}

async function detailForApplication(me: Session, applicationId: string): Promise<ApplicationDetail> {
  const application = await getApplication(me.userId, applicationId, me.client);
  if (!application) throw new CareerError('That application couldn’t be found.');
  const job = await getJob(me.userId, application.jobId, me.client);
  if (!job) throw new CareerError('That job couldn’t be found.');
  return detailFor(me, job, application);
}

// ─── Loading ──────────────────────────────────────────────────────────────

/** Everything the tab and the panel's Overview need in one read. */
export async function loadCareerAction(): Promise<Result<CareerHome>> {
  return signedIn('Career couldn’t be loaded. Try again in a little while.', async ({ userId, client }) => {
    const state = await getCareerState(userId);
    const now = new Date();
    const empty = { state, applications: [], jobs: [], events: [], unmatched: [], hotMatches: [], forYouCount: 0, now, timeZone: TIME_ZONE };
    if (!state.ready) return ok(composeHome(empty));
    const threshold = state.settings.threshold;
    const [applications, events, unmatched, forYouCount, matches] = await Promise.all([
      listApplications(userId, { limit: 500 }, client),
      listEvents(userId, { limit: 300 }, client),
      listEvents(userId, { unmatched: true, limit: 50 }, client),
      countForYou(userId, threshold, client),
      listJobs(userId, { view: 'for_you', threshold, limit: 30 }, client),
    ]);
    const jobs = applications.length ? await listJobsByIds(userId, applications.map((app) => app.jobId), client) : [];
    // Hot matches are unapplied: a job already drafted is in the queue instead.
    const pursued = new Set(applications.map((app) => app.jobId));
    const hotMatches = matches.filter((job) => !pursued.has(job.id));
    return ok(composeHome({ ...empty, applications, jobs, events, unmatched, hotMatches, forYouCount }));
  });
}

export async function loadSetupAction(): Promise<Result<CareerSetup>> {
  return signedIn('Setup couldn’t be loaded. Try again in a little while.', async ({ userId, client }) => {
    const row = await getCareerRow(userId, client);
    return ok({
      profile: row?.profile ?? null,
      spec: row?.spec ?? null,
      settings: row?.settings ?? readSettings(null),
      resumeFileName: row?.resumeName ?? null,
    });
  });
}

const JOB_VIEWS = ['for_you', 'everything', 'shortlisted'] as const;

export async function listJobsAction(filters: JobFilters): Promise<Result<JobsPage>> {
  if (!filters || typeof filters !== 'object' || !isOneOf(filters.view, JOB_VIEWS)) return INVALID;
  if (filters.search !== undefined && cleanText(filters.search, 100) === null) return INVALID;
  if (filters.source !== undefined && !isOneOf(filters.source, SOURCE_IDS)) return INVALID;
  if (filters.remoteOnly !== undefined && typeof filters.remoteOnly !== 'boolean') return INVALID;
  if (filters.minScore !== undefined && !isWhole(filters.minScore, 0, 100)) return INVALID;
  if (filters.offset !== undefined && !isWhole(filters.offset, 0, 10_000)) return INVALID;
  return signedIn('Jobs couldn’t be loaded. Try again in a little while.', async ({ userId, client }) => {
    const row = await getCareerRow(userId, client);
    const page = await listJobsPage(userId, {
      view: filters.view,
      threshold: row?.settings.threshold ?? 50,
      search: filters.search,
      source: filters.source,
      remoteOnly: filters.remoteOnly,
      minScore: filters.minScore,
      offset: filters.offset,
      limit: 30,
    }, client);
    return ok({ jobs: page.jobs.map(cardJob), total: page.total });
  });
}

export async function jobDetailAction(jobId: string): Promise<Result<ApplicationDetail>> {
  if (!isUuid(jobId)) return INVALID;
  return signedIn('That job couldn’t be loaded. Try again in a little while.', async (me) => {
    const job = await getJob(me.userId, jobId, me.client);
    if (!job) return fail('That job couldn’t be found.');
    const application = await getApplicationForJob(me.userId, jobId, me.client);
    return ok(await detailFor(me, job, application));
  });
}

// ─── Setup ────────────────────────────────────────────────────────────────

/** Step 1 of a resume upload: a signed URL the browser uploads the file to (PDF or DOCX, up to 10 MB). */
export async function createResumeUploadAction(file: { name: string; type: string; size: number }): Promise<Result<ResumeUpload>> {
  if (!file || typeof file !== 'object') return INVALID;
  return signedIn('The upload couldn’t be started. Try again in a little while.', async ({ userId }) => {
    const refused = await rateLimitRefusal(userId, 'uploads');
    if (refused) return fail(refused);
    const target = await createUploadTarget(userId, 'career-resume', { name: file.name, type: file.type, size: file.size });
    return ok({ path: target.path, signedUrl: target.signedUrl, token: target.token });
  });
}

/** Step 2: read the uploaded file, parse it with AI and merge it into the profile. */
export async function processResumeAction(path: string, fileName: string): Promise<Result<CareerProfile>> {
  const name = cleanText(fileName, 200) ?? 'resume';
  return signedIn('Your resume couldn’t be read just now. Try again in a little while.', async ({ userId, client }) => {
    if (!isCareerResumePath(userId, path)) return fail('That upload couldn’t be found. Choose the file again.');
    const refused = await gateAndLimit(userId, 'career_ai', true);
    if (refused) return fail(refused);
    if (!(await claimStaged(userId, path))) return fail(ALREADY_CLAIMED_MESSAGE);
    const previous = (await getCareerRow(userId, client))?.resumePath ?? null;
    const outcome = await processResume(client, userId, path, name);
    if (!outcome.ok) return fail(outcome.message);
    // The new file is the master resume now; the one it replaced isn't needed.
    if (previous && previous !== path && isCareerResumePath(userId, previous)) {
      const { error } = await client.storage.from(CAREER_BUCKET).remove([previous]);
      if (error) console.error('Removing the replaced resume failed', error);
    }
    refresh();
    return ok(outcome.profile);
  });
}

export async function saveProfileAction(profile: CareerProfile): Promise<Result<CareerProfile>> {
  if (tooBig(profile, 400_000)) return fail('That profile is too large to save.');
  const valid = validateProfile(profile);
  if (!valid) return fail('Some of the profile isn’t valid: check for empty names, very long text or dates not written as YYYY-MM.');
  return signedIn('Your profile couldn’t be saved. Try again in a little while.', async ({ userId, client }) => {
    await saveProfile(userId, valid, client);
    refresh();
    return ok(valid);
  });
}

export async function saveSpecAction(spec: CareerSpec): Promise<Result<CareerSpec>> {
  if (tooBig(spec, 50_000)) return fail('That search is too large to save.');
  const valid = validateSpec(spec);
  if (!valid) return fail('Some of what you’re looking for isn’t valid. Check the fields and try again.');
  return signedIn('Your search couldn’t be saved. Try again in a little while.', async ({ userId, client }) => {
    await saveSpec(userId, valid, client);
    refresh();
    return ok(valid);
  });
}

/** "Remote senior React roles above 30 LPA, no crypto" → a spec to review (not saved). */
export async function specFromSentenceAction(sentence: string): Promise<Result<CareerSpec>> {
  const text = cleanText(sentence, 2000, 3);
  if (!text) return fail('Say in a sentence what you’re looking for (up to 2,000 characters).');
  return signedIn('That couldn’t be turned into a search just now. Try again, or fill in the fields.', async ({ userId }) => {
    const refused = await gateAndLimit(userId, 'career_ai', true);
    if (refused) return fail(refused);
    const outcome = await specFromSentence(userId, text);
    return outcome.ok ? ok(outcome.spec) : fail(outcome.message);
  });
}

const SETTING_RANGES = {
  threshold: [30, 90], dailySendCap: [1, 200], weeklyGoal: [1, 200], followUpDays: [1, 60], ghostDays: [1, 365],
} as const;
const WATCH_ATS = ['greenhouse', 'lever', 'ashby', 'recruitee'] as const;
const WATCH_SLUG = /^[A-Za-z0-9][\w.-]{0,99}$/;

function cleanWatchlist(value: unknown): WatchedCompany[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const list: WatchedCompany[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const { ats, slug, name } = item as Record<string, unknown>;
    const label = cleanText(name, 100, 1);
    if (!isOneOf(ats, WATCH_ATS) || typeof slug !== 'string' || !WATCH_SLUG.test(slug.trim()) || !label) return null;
    list.push({ ats, slug: slug.trim(), name: label });
  }
  return list;
}

function cleanSynonyms(value: unknown): string[][] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const groups: string[][] = [];
  for (const group of value) {
    if (!Array.isArray(group) || group.length > 10) return null;
    const words = group.map((word) => cleanText(word, 60, 1));
    if (words.some((word) => word === null)) return null;
    if (words.length > 1) groups.push(words as string[]);
  }
  return groups;
}

function cleanSources(value: unknown): Partial<Record<SourceId, boolean>> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const sources: Partial<Record<SourceId, boolean>> = {};
  for (const [key, on] of Object.entries(value)) {
    if (!isOneOf(key, SOURCE_IDS) || typeof on !== 'boolean') return null;
    sources[key] = on;
  }
  return sources;
}

/** The patch with every field checked; a string naming what's wrong otherwise. */
function cleanSettings(patch: Partial<CareerSettings>): Partial<CareerSettings> | string {
  const clean: Partial<CareerSettings> = {};
  for (const [key, [min, max]] of Object.entries(SETTING_RANGES) as Array<[keyof typeof SETTING_RANGES, readonly [number, number]]>) {
    const value = patch[key];
    if (value === undefined) continue;
    if (!isWhole(value, min, max)) return `That value is out of range: use a whole number from ${min} to ${max}.`;
    clean[key] = value;
  }
  if (patch.sources !== undefined) {
    const sources = cleanSources(patch.sources);
    if (!sources) return 'Those sources aren’t valid.';
    clean.sources = sources as CareerSettings['sources'];
  }
  if (patch.watchlist !== undefined) {
    const watchlist = cleanWatchlist(patch.watchlist);
    if (!watchlist) return 'Check the company watchlist: each needs its ATS, a slug from its jobs page and a name (up to 50).';
    clean.watchlist = watchlist;
  }
  if (patch.synonyms !== undefined) {
    const synonyms = cleanSynonyms(patch.synonyms);
    if (!synonyms) return 'Those title synonyms aren’t valid.';
    clean.synonyms = synonyms;
  }
  if (patch.adzunaCountries !== undefined) {
    const countries = patch.adzunaCountries;
    if (!Array.isArray(countries) || countries.length > 10 || !countries.every((code) => typeof code === 'string' && /^[a-z]{2}$/.test(code))) {
      return 'Use two-letter country codes, such as in, gb or us.';
    }
    clean.adzunaCountries = countries;
  }
  return clean;
}

export async function saveSettingsAction(patch: Partial<CareerSettings>): Promise<Result<CareerSettings>> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return INVALID;
  const clean = cleanSettings(patch);
  if (typeof clean === 'string') return fail(clean);
  return signedIn('Settings couldn’t be saved. Try again in a little while.', async ({ userId, client }) => {
    const settings = await saveSettings(userId, clean, client);
    refresh();
    return ok(settings);
  });
}

// ─── Jobs ─────────────────────────────────────────────────────────────────

const MIN_DESCRIPTION = 80;
const MAX_DESCRIPTION = 20_000;

function httpUrl(text: string | null): string | null {
  if (!text) return null;
  try {
    const url = new URL(text);
    return (url.protocol === 'https:' || url.protocol === 'http:') && text.length <= 2048 ? url.toString() : null;
  } catch {
    return null;
  }
}

/** A job the owner pasted from any other site: only what they gave, nothing fetched. */
function pastedJob(input: { url: string | null; text: string | null; title: string; company: string }): NormalizedJob {
  const ref = createHash('sha256').update(`${input.url ?? ''}\n${input.title}\n${input.company}\n${(input.text ?? '').slice(0, 2000)}`).digest('hex').slice(0, 32);
  // Without a link there's nowhere to apply yet; a search for the listing is the honest stand-in.
  const url = input.url ?? `https://www.google.com/search?q=${encodeURIComponent(`${input.title} ${input.company} jobs`)}`;
  return {
    source: 'pasted',
    sourceRef: ref,
    title: input.title,
    company: input.company,
    location: null,
    remote: looksRemote(input.title, input.text),
    url,
    applyUrl: null,
    applyEmail: null,
    description: input.text,
    thin: !input.text,
    salary: null,
    postedAt: null,
    attribution: null,
  };
}

/** A job URL (Greenhouse/Lever/Ashby/Recruitee are read from their API) and/or its pasted description. */
export async function pasteJobAction(input: { url?: string; text?: string; title?: string; company?: string }): Promise<Result<{ jobId: string }>> {
  if (!input || typeof input !== 'object') return INVALID;
  const rawUrl = input.url === undefined ? null : cleanText(input.url, 2048, 1);
  const url = httpUrl(rawUrl);
  if (input.url !== undefined && !url) return fail('That link isn’t a web address. Paste the full link, starting with https://.');
  const text = input.text === undefined ? null : cleanText(input.text, MAX_DESCRIPTION);
  if (input.text !== undefined && text === null) return fail('That description is too long. Paste up to 20,000 characters.');
  if (text && text.length < MIN_DESCRIPTION) return fail('Paste the whole description, from the role to the benefits.');
  const title = input.title === undefined ? null : cleanText(input.title, 300, 1);
  const company = input.company === undefined ? null : cleanText(input.company, 200, 1);
  if (!url && !text) return fail('Paste a link to the listing or its description.');

  return signedIn('That job couldn’t be added. Try again in a little while.', async ({ userId, client }) => {
    const refused = await rateLimitRefusal(userId, 'career_ai');
    if (refused) return fail(refused);
    let job: NormalizedJob | null = null;
    if (url && pastedUrlKind(url)) {
      job = await fetchPastedJob(url);
      if (!job && !text) return fail('That listing couldn’t be read from its jobs page. Paste the description too.');
      if (job && text && !job.description) job = { ...job, description: text, thin: false };
    }
    if (!job) {
      if (!title || !company) return fail('Add the job title and company too: only Greenhouse, Lever, Ashby and Recruitee links are read without them.');
      job = pastedJob({ url, text, title, company });
    }
    const key = dedupeKey(job);
    const [created] = await upsertJobs(client, userId, [{ ...job, dedupeKey: key }]);
    const jobId = created ?? (await findJobIdByKey(userId, key, client));
    if (!jobId) return fail('That job couldn’t be saved. Check the link and try again.');
    const row = await getCareerRow(userId, client);
    const stored = await getJob(userId, jobId, client);
    if (isProfiled(row) && stored) {
      await scoreJob(client, userId, stored, row.profile, row.spec, row.settings, { timeoutMs: 20_000 });
    }
    refresh();
    return ok({ jobId });
  });
}

const OWNER_JOB_STATES: readonly JobState[] = ['new', 'shortlisted', 'dismissed'];

export async function setJobStateAction(jobId: string, state: JobState, reason?: string): Promise<Result<CareerJob>> {
  if (!isUuid(jobId) || !isOneOf(state, OWNER_JOB_STATES)) return INVALID;
  if (reason !== undefined && cleanText(reason, 300) === null) return fail('Keep the reason under 300 characters.');
  return signedIn('That couldn’t be saved. Try again in a little while.', async ({ userId, client }) => {
    if (!(await setJobState(userId, jobId, state, reason ?? null, client))) return fail('That job couldn’t be found.');
    const job = await getJob(userId, jobId, client);
    if (!job) return fail('That job couldn’t be found.');
    refresh();
    return ok(job);
  });
}

/** Re-extract and rescore, optionally with a pasted full description for a thin job. */
export async function rescoreJobAction(jobId: string, description?: string): Promise<Result<CareerJob>> {
  if (!isUuid(jobId)) return INVALID;
  const text = description === undefined ? null : cleanText(description, MAX_DESCRIPTION, MIN_DESCRIPTION);
  if (description !== undefined && !text) return fail('Paste the whole description (80 to 20,000 characters).');
  return signedIn('That job couldn’t be scored. Try again in a little while.', async ({ userId, client }) => {
    const refused = await gateAndLimit(userId, 'career_ai', true);
    if (refused) return fail(refused);
    const row = await getCareerRow(userId, client);
    if (!isProfiled(row)) return fail(SET_UP_FIRST);
    if (text && !(await setJobDescription(userId, jobId, text, client))) return fail('That job couldn’t be found.');
    const job = await getJob(userId, jobId, client);
    if (!job) return fail('That job couldn’t be found.');
    await scoreJob(client, userId, job, row.profile, row.spec, row.settings, { timeoutMs: 25_000 });
    const scored = await getJob(userId, jobId, client);
    refresh();
    return scored ? ok(scored) : fail('That job couldn’t be found.');
  });
}

// ─── Applications ─────────────────────────────────────────────────────────

/** Tailor the resume, cover note and answers for a job, and render the files. */
export async function draftApplicationAction(jobId: string): Promise<Result<ApplicationDetail>> {
  if (!isUuid(jobId)) return INVALID;
  return signedIn('The application couldn’t be drafted. Try again in a little while.', async (me) => {
    const refused = await gateAndLimit(me.userId, 'career_ai', true);
    if (refused) return fail(refused);
    const outcome = await draftApplication(me.client, me.userId, jobId, { deadline: Date.now() + ACTION_BUDGET_MS });
    refresh();
    if (!outcome.ok) return fail(outcome.message);
    return ok(await detailForApplication(me, outcome.applicationId));
  });
}

const EDITABLE: readonly ApplicationStatus[] = ['ready', 'opened', 'failed'];

/** The patch with every field checked, or null. */
function cleanPatch(patch: DraftPatch): DraftPatch | null {
  if (!patch || typeof patch !== 'object') return null;
  const clean: DraftPatch = {};
  if (patch.coverNote !== undefined) {
    const text = cleanText(patch.coverNote, 3000);
    if (text === null) return null;
    clean.coverNote = text;
  }
  if (patch.summary !== undefined) {
    const text = cleanText(patch.summary, 2000);
    if (text === null) return null;
    clean.summary = text;
  }
  if (patch.answers !== undefined) {
    if (!Array.isArray(patch.answers) || patch.answers.length > 40) return null;
    const answers = patch.answers.map((item) => ({ question: cleanText(item?.question, 500, 1), answer: cleanText(item?.answer, 3000) }));
    if (answers.some((item) => item.question === null || item.answer === null)) return null;
    clean.answers = answers as DraftPatch['answers'];
  }
  if (patch.roleBullets !== undefined) {
    const { roleId, bullets } = patch.roleBullets ?? {};
    if (typeof roleId !== 'string' || !/^r_[a-z0-9]{1,20}$/.test(roleId) || !Array.isArray(bullets) || bullets.length > 10) return null;
    const lines = bullets.map((line) => cleanText(line, 500));
    if (lines.some((line) => line === null)) return null;
    clean.roleBullets = { roleId, bullets: lines as string[] };
  }
  return clean;
}

export async function updateDraftAction(applicationId: string, patch: DraftPatch): Promise<Result<ApplicationDetail>> {
  if (!isUuid(applicationId)) return INVALID;
  const clean = cleanPatch(patch);
  if (!clean) return fail('Some of that text is too long or empty. Check it and try again.');
  return signedIn('Your changes couldn’t be saved. Try again in a little while.', async (me) => {
    const application = await getApplication(me.userId, applicationId, me.client);
    if (!application) return fail('That application couldn’t be found.');
    if (!EDITABLE.includes(application.status) || !application.draft) return fail('This application can’t be edited now.');
    const [job, row] = await Promise.all([getJob(me.userId, application.jobId, me.client), getCareerRow(me.userId, me.client)]);
    if (!job) return fail('That job couldn’t be found.');
    if (!row?.profile) return fail(SET_UP_FIRST);
    const redrafted = redraftText({ application, patch: clean, profile: row.profile, requirements: job.requirements, job: { company: job.company, title: job.title } });
    let saved = await updateApplication(me.userId, application.id, {
      draft: redrafted.draft, coverNote: redrafted.coverNote, answers: redrafted.answers, outreach: redrafted.outreach || null, removed: redrafted.removed,
    }, me.client);
    // Only the resume's own text changes the files; a cover note or answer doesn't.
    if (clean.summary !== undefined || clean.roleBullets !== undefined) {
      const files = await renderAndStore(me.client, me.userId, { applicationId: application.id, profile: row.profile, draft: redrafted.draft, requirements: job.requirements });
      saved = await updateApplication(me.userId, application.id, { pdfPath: files.pdfPath, docxPath: files.docxPath, ats: files.ats }, me.client);
    }
    refresh();
    const detail = await detailFor(me, job, saved ?? application, row);
    return ok({ ...detail, highlights: redrafted.highlights });
  });
}

function toOutcome(result: Awaited<ReturnType<typeof sendApplication>>, detail: ApplicationDetail): SendOutcome {
  if (result.kind === 'compose') return { kind: 'compose', url: result.url, detail };
  if (result.kind === 'opened') return result.message ? { kind: 'opened', url: result.url, detail, message: result.message } : { kind: 'opened', url: result.url, detail };
  return { kind: 'sent', detail };
}

/** A confirmation from the browser, checked: an address within limits and a real boolean. */
function cleanConfirmation(value: unknown): SendConfirmation | null {
  if (value === undefined) return { to: null, confirmed: false };
  if (!value || typeof value !== 'object') return null;
  const { to, confirmed } = value as Record<string, unknown>;
  const address = to === null || to === undefined ? null : cleanText(to, 320, 3);
  if (to !== null && to !== undefined && address === null) return null;
  if (confirmed !== undefined && typeof confirmed !== 'boolean') return null;
  return { to: address, confirmed: confirmed === true };
}

/**
 * The owner's Send. Never called by anything but a press of Send. `confirm`
 * is what the Send bar showed: the email route sends only to that address,
 * and only once the owner confirmed an address Orbis hasn't used before.
 */
export async function sendApplicationAction(applicationId: string, confirm?: SendConfirmation): Promise<Result<SendOutcome>> {
  const confirmation = cleanConfirmation(confirm);
  if (!isUuid(applicationId) || !confirmation) return INVALID;
  return signedIn('That couldn’t be sent, and nothing went out. Try again in a little while.', async (me) => {
    const refused = await rateLimitRefusal(me.userId, 'career_send');
    if (refused) return fail(refused);
    const result = await sendApplication(me.client, me.userId, applicationId, confirmation);
    refresh();
    if (result.kind === 'refused') return fail(result.message);
    return ok(toOutcome(result, await detailForApplication(me, applicationId)));
  });
}

/** After a link apply or a compose window: the owner confirms it went out. */
export async function markAppliedAction(applicationId: string): Promise<Result<ApplicationDetail>> {
  if (!isUuid(applicationId)) return INVALID;
  return signedIn('That couldn’t be saved. Try again in a little while.', async (me) => {
    const result = await markApplied(me.client, me.userId, applicationId);
    if (!result.ok) return fail(result.message);
    refresh();
    return ok(await detailForApplication(me, applicationId));
  });
}

const MOVE_LABELS: Record<ApplicationStatus, string> = {
  drafting: 'Draft again',
  ready: 'Back to the queue',
  sending: 'Send',
  opened: 'Opened the apply page',
  sent: 'I applied',
  acknowledged: 'They acknowledged it',
  replied: 'They replied',
  assessment: 'Assessment',
  interview: 'Interview booked',
  offer: 'Got an offer',
  accepted: 'Accepted the offer',
  declined: 'Declined the offer',
  rejected: 'Rejected',
  withdrawn: 'Withdraw',
  ghosted: 'No reply',
  failed: 'Failed',
};

// Send, drafting and the apply page each have their own button; they aren't drags.
const NOT_BY_HAND: readonly ApplicationStatus[] = ['sending', 'drafting', 'opened'];
const CLOSED: readonly ApplicationStatus[] = ['accepted', 'declined', 'rejected', 'withdrawn'];

function movesFrom(status: ApplicationStatus): OwnerMove[] {
  return ownerMoves(status).filter((to) => !NOT_BY_HAND.includes(to)).map((to) => ({ to, label: MOVE_LABELS[to] }));
}

export async function ownerMovesAction(applicationId: string): Promise<Result<OwnerMove[]>> {
  if (!isUuid(applicationId)) return INVALID;
  return signedIn('That couldn’t be loaded. Try again in a little while.', async ({ userId, client }) => {
    const application = await getApplication(userId, applicationId, client);
    if (!application) return fail('That application couldn’t be found.');
    return ok(movesFrom(application.status));
  });
}

export async function moveApplicationAction(applicationId: string, to: ApplicationStatus): Promise<Result<ApplicationDetail>> {
  if (!isUuid(applicationId) || !isOneOf(to, APPLICATION_STATUSES)) return INVALID;
  return signedIn('That couldn’t be moved. Try again in a little while.', async (me) => {
    const application = await getApplication(me.userId, applicationId, me.client);
    if (!application) return fail('That application couldn’t be found.');
    if (to === 'sent') {
      const result = await markApplied(me.client, me.userId, applicationId);
      if (!result.ok) return fail(result.message);
    } else {
      if (NOT_BY_HAND.includes(to) || !canTransition(application.status, to, 'owner')) return fail('It can’t move there from where it is.');
      const patch = CLOSED.includes(to) ? { followUpDue: null, followUpDraft: null } : {};
      if (!(await transitionApplication(me.client, me.userId, applicationId, [application.status], to, patch))) {
        return fail('It moved in the meantime. Reload and try again.');
      }
      await addEvent(me.userId, {
        applicationId, kind: 'status_change', summary: `You moved it to ${MOVE_LABELS[to].toLowerCase()}`, details: { from: application.status, to, by: 'owner' },
      }, me.client);
    }
    refresh();
    return ok(await detailForApplication(me, applicationId));
  });
}

const REPLY_KIND_OF: Partial<Record<EventKind, ReplyKind>> = {
  acknowledgement: 'acknowledgement',
  rejection: 'rejection',
  interview_invite: 'interview_invite',
  assessment: 'assessment',
  recruiter_question: 'recruiter_question',
  offer: 'offer',
  reply: 'other',
};
const EMPTY_TERMS: OfferTerms = { fixed: null, variable: null, joiningBonus: null, equity: null, currency: null, period: null, startDate: null, deadline: null };

/**
 * What an attached reply sets off, as if the watcher had linked it: the status
 * (only where mail may move it, canTransition), and an offer to confirm. The
 * owner's attach is the evidence the watcher lacked. `read` is the reply's
 * classification when it was only read now (it was recorded unread).
 */
async function actOnAttached(me: Session, application: CareerApplication, event: CareerEvent, read: ReplyClassification | null) {
  const kind = read?.kind ?? REPLY_KIND_OF[event.kind];
  const target = kind ? statusFromReply(application.status, kind) : null;
  if (target && (await transitionApplication(me.client, me.userId, application.id, [application.status], target))) {
    await addEvent(me.userId, {
      applicationId: application.id, kind: 'status_change', summary: `A reply you attached moved it to ${MOVE_LABELS[target].toLowerCase()}`,
      details: { from: application.status, to: target, by: 'owner' },
    }, me.client);
  }
  if (kind === 'offer' && !(await listOffers(me.userId, { applicationId: application.id }, me.client)).length) {
    await createOffer(me.userId, { applicationId: application.id, terms: read?.offer ?? EMPTY_TERMS }, me.client);
  }
}

/** Reads an attached reply that was recorded unread, within the owner's AI allowance; null when it can't be now. */
async function readAttached(me: Session, event: CareerEvent): Promise<ReplyClassification | null> {
  if (event.details.classified !== false || !event.gmailMessageId) return null;
  if (await gateAndLimit(me.userId, 'career_ai', true)) return null;
  try {
    return await classifyAttached(me.userId, event);
  } catch (error) {
    console.error('Classifying an attached reply failed', error);
    return null;
  }
}

export async function attachReplyAction(eventId: string, applicationId: string): Promise<Result<ApplicationDetail>> {
  if (!isUuid(eventId) || !isUuid(applicationId)) return INVALID;
  return signedIn('That reply couldn’t be attached. Try again in a little while.', async (me) => {
    const [application, unmatched] = await Promise.all([
      getApplication(me.userId, applicationId, me.client),
      listEvents(me.userId, { unmatched: true, limit: 1000 }, me.client),
    ]);
    if (!application) return fail('That application couldn’t be found.');
    const event = unmatched.find((item) => item.id === eventId);
    if (!event || !(await linkEvent(me.userId, eventId, applicationId, me.client))) return fail('That reply is already attached.');
    await actOnAttached(me, application, event, await readAttached(me, event));
    refresh();
    return ok(await detailForApplication(me, applicationId));
  });
}

export async function sendFollowUpAction(applicationId: string, text: string): Promise<Result<ApplicationDetail>> {
  if (!isUuid(applicationId)) return INVALID;
  const body = cleanText(text, 5000, 1);
  if (!body) return fail('Write the follow-up first (up to 5,000 characters).');
  return signedIn('The follow-up couldn’t be sent, and nothing went out. Try again in a little while.', async (me) => {
    const refused = await rateLimitRefusal(me.userId, 'career_send');
    if (refused) return fail(refused);
    const result = await sendFollowUp(me.client, me.userId, applicationId, body);
    if (!result.ok) return fail(result.message);
    refresh();
    return ok(await detailForApplication(me, applicationId));
  });
}

// ─── Offers ───────────────────────────────────────────────────────────────

export async function saveOfferTermsAction(applicationId: string, terms: OfferTerms): Promise<Result<ApplicationDetail>> {
  if (!isUuid(applicationId)) return INVALID;
  const valid = validateTerms(terms);
  if (!valid) return fail('Some of the offer isn’t valid. Check the amounts and dates.');
  return signedIn('The offer couldn’t be saved. Try again in a little while.', async (me) => {
    const application = await getApplication(me.userId, applicationId, me.client);
    if (!application) return fail('That application couldn’t be found.');
    const [existing] = await listOffers(me.userId, { applicationId }, me.client);
    // Confirmed: the owner has checked the terms, so advice may now be given.
    if (existing) await updateOffer(me.userId, existing.id, { terms: valid, confirmed: true, advice: null }, me.client);
    else await createOffer(me.userId, { applicationId, terms: valid, confirmed: true }, me.client);
    // An offer entered by hand (one made on a call) moves the card too.
    if (application.status !== 'offer' && canTransition(application.status, 'offer', 'owner')) {
      if (await transitionApplication(me.client, me.userId, applicationId, [application.status], 'offer')) {
        await addEvent(me.userId, { applicationId, kind: 'status_change', summary: 'You recorded an offer', details: { from: application.status, to: 'offer', by: 'owner' } }, me.client);
      }
    }
    refresh();
    return ok(await detailForApplication(me, applicationId));
  });
}

/** A few lines about the owner for the advisor: level, years, roles, top skills and standout facts. */
function profileSummary(profile: CareerProfile, today: string): string {
  const lines = [
    profile.headline ?? '',
    `${totalYears(profile, today)} years of experience.`,
    ...profile.roles.slice(0, 6).map((role) => `- ${role.title} at ${role.employer} (${role.start}–${role.end ?? 'now'})`),
    `Skills: ${profile.skills.slice(0, 15).map((skill) => skill.label).join(', ')}`,
    ...profile.facts.slice(0, 6).map((fact) => `- ${fact.text}`),
  ];
  return lines.filter(Boolean).join('\n');
}

/** Other live interviews and offers: the leverage the advisor may cite. */
async function competingFor(me: Session, applicationId: string): Promise<CompetingOffer[]> {
  const [others, offers] = await Promise.all([
    listApplications(me.userId, { statuses: ['interview', 'offer'], limit: 50 }, me.client),
    listOffers(me.userId, {}, me.client),
  ]);
  const live = others.filter((app) => app.id !== applicationId);
  if (!live.length) return [];
  const companies = new Map((await listJobsByIds(me.userId, live.map((app) => app.jobId), me.client)).map((job) => [job.id, job.company]));
  return live.map((app) => {
    const confirmed = offers.find((offer) => offer.applicationId === app.id && offer.confirmed);
    return {
      company: companies.get(app.jobId) ?? 'Another company',
      stage: app.status === 'offer' ? 'offer' : 'interview',
      annual: confirmed ? annualise(confirmed.terms) : null,
      currency: confirmed?.terms.currency ?? null,
    };
  });
}

export async function adviseOfferAction(offerId: string): Promise<Result<OfferAdvice>> {
  if (!isUuid(offerId)) return INVALID;
  return signedIn('No advice could be written just now. Try again in a little while.', async (me) => {
    const offer = await getOffer(me.userId, offerId, me.client);
    if (!offer) return fail('That offer couldn’t be found.');
    if (!offer.confirmed) return fail('Check the offer’s terms and save them first.');
    const row = await getCareerRow(me.userId, me.client);
    if (!isProfiled(row)) return fail(SET_UP_FIRST);
    const refused = await gateAndLimit(me.userId, 'career_ai', true);
    if (refused) return fail(refused);
    const today = careerToday();
    const [insights, competing] = await Promise.all([
      loadInsights(me.client, me.userId, today).catch((error: unknown) => {
        console.error('Salary pulse for offer advice failed', error);
        return null;
      }),
      competingFor(me, offer.applicationId),
    ]);
    const pulses = (insights?.salary ?? []).filter((pulse) => pulse.currency === offer.terms.currency);
    const pulse = pulses.find((item) => item.period === (offer.terms.period ?? 'year')) ?? pulses[0] ?? null;
    const advice = await adviseOffer(me.userId, { terms: offer.terms, spec: row.spec, profileSummary: profileSummary(row.profile, today), pulse, competing });
    if (!advice) return fail('No AI model could advise on this offer just now. Try again in a little while.');
    const competingAnnual = competing.flatMap((other) => (other.annual !== null && other.currency === offer.terms.currency ? [other.annual] : []));
    const capped = capCounter(advice, offer.terms, pulses, competingAnnual);
    await updateOffer(me.userId, offerId, { advice: capped }, me.client);
    refresh();
    return ok(capped);
  });
}

/** The offer reply's Send; `to` is the recipient the screen showed, and nothing goes if that has changed. */
export async function sendOfferReplyAction(offerId: string, text: string, to: string): Promise<Result<ApplicationDetail>> {
  if (!isUuid(offerId)) return INVALID;
  const body = cleanText(text, 5000, 1);
  if (!body) return fail('Write the reply first (up to 5,000 characters).');
  const expectedTo = cleanText(to, 320, 3);
  if (!expectedTo) return INVALID;
  return signedIn('The reply couldn’t be sent, and nothing went out. Try again in a little while.', async (me) => {
    const refused = await rateLimitRefusal(me.userId, 'career_send');
    if (refused) return fail(refused);
    const result = await sendOfferReply(me.client, me.userId, offerId, body, expectedTo);
    if (!result.ok) return fail(result.message);
    refresh();
    const offer = await getOffer(me.userId, offerId, me.client);
    return ok(await detailForApplication(me, result.applicationId ?? offer?.applicationId ?? ''));
  });
}

// ─── Search, insights, export ─────────────────────────────────────────────

/** Run this owner's search now instead of waiting for the next scheduled run. */
export async function runSearchNowAction(): Promise<Result<{ found: number; scored: number; drafted: number }>> {
  return signedIn('The search couldn’t run just now. Try again in a little while.', async ({ userId, client }) => {
    if (!isProfiled(await getCareerRow(userId, client))) return fail(SET_UP_FIRST);
    const refused = await rateLimitRefusal(userId, 'career_search');
    if (refused) return fail(refused);
    // The search writes the service-role bookkeeping (source cursors, last run),
    // so it runs with the admin client, for this signed-in owner only.
    const summary = await ingestUser(createAdminClient(), userId, { deadline: Date.now() + ACTION_BUDGET_MS, manual: true });
    refresh();
    return ok(summary);
  });
}

export async function insightsAction(): Promise<Result<CareerInsights>> {
  return signedIn('Insights couldn’t be loaded. Try again in a little while.', async ({ userId, client }) => {
    const insights = await loadInsights(client, userId, careerToday());
    return insights ? ok(insights) : fail(SET_UP_FIRST);
  });
}

/** The tracker as CSV text. */
export async function exportTrackerAction(): Promise<Result<string>> {
  return signedIn('The tracker couldn’t be exported. Try again in a little while.', async ({ userId, client }) => {
    const applications = (await listApplications(userId, { limit: 1000 }, client)).filter((app) => app.status !== 'drafting');
    const [jobs, events] = await Promise.all([
      applications.length ? listJobsByIds(userId, applications.map((app) => app.jobId), client) : Promise.resolve([]),
      listEvents(userId, { limit: 1000 }, client),
    ]);
    const byId = new Map(jobs.map((job) => [job.id, job]));
    // Events come newest first, so the first one seen per application is its latest.
    const latest = new Map<string, string>();
    for (const event of events) if (event.applicationId && !latest.has(event.applicationId)) latest.set(event.applicationId, event.summary);
    const rows = applications.flatMap((application) => {
      const job = byId.get(application.jobId);
      return job ? [{ application, job, latest: latest.get(application.id) ?? null }] : [];
    });
    return ok(trackerCsv(rows));
  });
}
