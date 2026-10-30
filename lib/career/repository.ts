import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { isMissingTable } from '@/lib/supabase/errors';
import { isRecord } from '@/lib/ai/json';
import { CAREER_BUCKET } from '@/lib/storage/upload-rules';
import { listingPatch, type StoredListing } from '@/lib/career/recipient';
import {
  APPLICATION_STATUSES,
  DEFAULT_SETTINGS,
  EVENT_KINDS,
  SOURCE_IDS,
  type ApplicationStatus,
  type ApplyRoute,
  type AtsReport,
  type CareerApplication,
  type CareerEvent,
  type CareerJob,
  type CareerOffer,
  type CareerProfile,
  type CareerSettings,
  type CareerSpec,
  type CareerState,
  type CitedText,
  type EventKind,
  type InterviewPrep,
  type JobState,
  type Match,
  type Money,
  type NormalizedJob,
  type OfferAdvice,
  type OfferTerms,
  type Prediction,
  type Requirements,
  type ScreeningAnswer,
  type SourceId,
  type TailoredDraft,
  type TruthRemoval,
  type WatchedCompany,
} from '@/lib/career/types';

// The Career tables (supabase/migrations/202610270001_career.sql). Owner reads
// and writes go through the person's own session, so row-level security keeps
// every query to their rows; the crons pass the admin client instead. Every
// JSON column is shape-checked on the way out, and a malformed value is
// dropped rather than handed to a screen that would trip over it.

/** The session client or the admin client; both speak the same API. */
export type CareerDb = SupabaseClient;

/** An error whose message is safe to show as-is. */
export class CareerError extends Error {}

const SETUP_MESSAGE = 'Career isn’t set up yet. Try again in a little while.';
const LOAD_MESSAGE = 'Career couldn’t be loaded. Try again in a little while.';
const SAVE_MESSAGE = 'That couldn’t be saved. Try again in a little while.';
const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const SIGNED_URL_SECONDS = 10 * 60;
// Keys per `.in()` filter, so the request URL stays well under proxy limits.
const IN_CHUNK = 40;
const MAX_SIGHTINGS = 20;

type Row = Record<string, unknown>;

/** The user-facing error for a failed query; the detail goes to the server log. */
function failed(error: { code?: string; message?: string }, message: string) {
  console.error(message, error);
  return new CareerError(isMissingTable(error) ? SETUP_MESSAGE : message);
}

async function dbOr(db?: CareerDb): Promise<CareerDb> {
  return db ?? (await createClient());
}

function chunks<T>(items: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) out.push(items.slice(start, start + size));
  return out;
}

// ─── Shape checks ─────────────────────────────────────────────────────────

const str = (value: unknown) => (typeof value === 'string' ? value : null);
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
const records = (value: unknown) => (Array.isArray(value) ? value.filter(isRecord) : []);
const hasStrings = (row: Row, keys: string[]) => keys.every((key) => typeof row[key] === 'string');
const hasArrays = (row: Row, keys: string[]) => keys.every((key) => Array.isArray(row[key]));

/** The value as T when it is an object that passes `test`, else null. */
function shaped<T>(value: unknown, test: (row: Row) => boolean): T | null {
  return isRecord(value) && test(value) ? (value as T) : null;
}

/** The array's objects that pass `test`; anything else is dropped. */
function listOf<T>(value: unknown, test: (row: Row) => boolean): T[] {
  return records(value).filter(test) as T[];
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

const SENIORITY = ['intern', 'junior', 'mid', 'senior', 'lead', 'principal', 'manager', 'director', 'executive'] as const;
const WORK_MODES = ['remote', 'hybrid', 'onsite'] as const;
const PERIODS = ['year', 'month', 'hour'] as const;
const JOB_STATES = ['new', 'shortlisted', 'dismissed', 'applied'] as const;
const ROUTES = ['email', 'recruitee', 'link'] as const;
const VERDICTS = ['accept', 'negotiate', 'walk_away'] as const;

function readProfile(value: unknown): CareerProfile | null {
  if (!isRecord(value) || !isRecord(value.contact)) return null;
  const contact = value.contact;
  return {
    contact: {
      name: str(contact.name) ?? '',
      email: str(contact.email) ?? '',
      phone: str(contact.phone),
      location: str(contact.location),
      links: listOf(contact.links, (link) => hasStrings(link, ['label', 'url'])),
    },
    headline: str(value.headline),
    summary: str(value.summary),
    roles: listOf(value.roles, (role) => hasStrings(role, ['id', 'title', 'employer', 'start'])),
    education: listOf(value.education, (item) => hasStrings(item, ['id', 'institution', 'degree'])),
    certifications: listOf(value.certifications, (item) => hasStrings(item, ['id', 'name'])),
    projects: listOf(value.projects, (item) => hasStrings(item, ['id', 'name']) && Array.isArray(item.factIds)),
    skills: listOf(value.skills, (item) => hasStrings(item, ['name', 'label'])),
    facts: listOf(value.facts, (item) => hasStrings(item, ['id', 'text']) && Array.isArray(item.skills)),
    languages: strings(value.languages),
  };
}

function readMoney(value: unknown): Money | null {
  if (!isRecord(value)) return null;
  const amount = num(value.amount);
  const currency = str(value.currency);
  const period = oneOf(value.period, PERIODS);
  return amount !== null && currency && period ? { amount, currency, period } : null;
}

function readSpec(value: unknown): CareerSpec | null {
  if (!isRecord(value)) return null;
  return {
    roles: strings(value.roles),
    seniority: strings(value.seniority).filter((item) => oneOf(item, SENIORITY)) as CareerSpec['seniority'],
    workModes: strings(value.workModes).filter((item) => oneOf(item, WORK_MODES)) as CareerSpec['workModes'],
    locations: strings(value.locations),
    timezones: strings(value.timezones),
    salaryFloor: readMoney(value.salaryFloor),
    salaryTarget: readMoney(value.salaryTarget),
    companyStages: strings(value.companyStages),
    mustHaves: strings(value.mustHaves),
    dealBreakers: strings(value.dealBreakers),
    noticeDays: num(value.noticeDays),
    notes: str(value.notes),
  };
}

/** A whole number within [min, max], or the fallback. */
function wholeIn(value: unknown, min: number, max: number, fallback: number) {
  const n = num(value);
  return n !== null && Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

const WATCH_ATS = ['greenhouse', 'lever', 'ashby', 'recruitee'] as const;

function readSources(value: unknown): Record<SourceId, boolean> {
  const stored = isRecord(value) ? value : {};
  const sources = { ...DEFAULT_SETTINGS.sources };
  for (const id of SOURCE_IDS) if (typeof stored[id] === 'boolean') sources[id] = stored[id];
  return sources;
}

// The same caps saveSettingsAction applies (app/career/actions.ts), re-applied on read: settings written
// straight through PostgREST skip that action, and the ingest cron fetches once per watched company.
const MAX_WATCHLIST = 50;
const MAX_SYNONYM_GROUPS = 50;
const MAX_SYNONYMS_PER_GROUP = 10;
const MAX_ADZUNA_COUNTRIES = 10;

/** Stored settings over the defaults; any value out of range falls back to its default, and long lists are cut. */
export function readSettings(value: unknown): CareerSettings {
  const stored = isRecord(value) ? value : {};
  const d = DEFAULT_SETTINGS;
  return {
    threshold: wholeIn(stored.threshold, 30, 90, d.threshold),
    dailySendCap: wholeIn(stored.dailySendCap, 1, 200, d.dailySendCap),
    weeklyGoal: wholeIn(stored.weeklyGoal, 1, 200, d.weeklyGoal),
    followUpDays: wholeIn(stored.followUpDays, 1, 60, d.followUpDays),
    ghostDays: wholeIn(stored.ghostDays, 1, 365, d.ghostDays),
    sources: readSources(stored.sources),
    watchlist: Array.isArray(stored.watchlist)
      ? listOf<WatchedCompany>(stored.watchlist.slice(0, MAX_WATCHLIST), (item) => hasStrings(item, ['slug', 'name']) && oneOf(item.ats, WATCH_ATS) !== null)
      : d.watchlist,
    synonyms: Array.isArray(stored.synonyms)
      ? stored.synonyms.slice(0, MAX_SYNONYM_GROUPS).map((group) => strings(group).slice(0, MAX_SYNONYMS_PER_GROUP)).filter((group) => group.length > 1)
      : d.synonyms,
    adzunaCountries: Array.isArray(stored.adzunaCountries) ? strings(stored.adzunaCountries.slice(0, MAX_ADZUNA_COUNTRIES)) : d.adzunaCountries,
  };
}

function readSalary(value: unknown): NormalizedJob['salary'] {
  if (!isRecord(value)) return null;
  const currency = str(value.currency);
  const period = oneOf(value.period, PERIODS);
  if (!currency || !period) return null;
  return { min: num(value.min), max: num(value.max), currency, period };
}

function readSightings(value: unknown): CareerJob['seenOn'] {
  return records(value).flatMap((item) => {
    const source = oneOf(item.source, SOURCE_IDS);
    const url = str(item.url);
    return source && url ? [{ source, url, attribution: str(item.attribution) }] : [];
  });
}

const readRequirements = (value: unknown) =>
  shaped<Requirements>(value, (row) => hasArrays(row, ['mustHave', 'niceToHave', 'screeningQuestions']) && isRecord(row.locationPolicy));
const readMatch = (value: unknown) => shaped<Match>(value, (row) => num(row.score) !== null && Array.isArray(row.lines) && isRecord(row.parts));
const readRecruitee = (value: unknown) => shaped<{ company: string; offer: string }>(value, (row) => hasStrings(row, ['company', 'offer']));

// ─── Profiles ─────────────────────────────────────────────────────────────

export type CareerRow = {
  profile: CareerProfile | null;
  spec: CareerSpec | null;
  settings: CareerSettings;
  resumePath: string | null;
  resumeName: string | null;
  resumeText: string | null;
  lastIngestAt: string | null;
  lastMailScanAt: string | null;
  sourceCursors: Partial<Record<SourceId, string>>;
};

const PROFILE_COLUMNS = 'profile,spec,settings,resume_path,resume_name,resume_text,last_ingest_at,last_mail_scan_at,source_cursors';

function readCursors(value: unknown): Partial<Record<SourceId, string>> {
  const stored = isRecord(value) ? value : {};
  const cursors: Partial<Record<SourceId, string>> = {};
  for (const id of SOURCE_IDS) if (typeof stored[id] === 'string') cursors[id] = stored[id];
  return cursors;
}

function toCareerRow(row: Row): CareerRow {
  return {
    profile: readProfile(row.profile),
    spec: readSpec(row.spec),
    settings: readSettings(row.settings),
    resumePath: str(row.resume_path),
    resumeName: str(row.resume_name),
    resumeText: str(row.resume_text),
    lastIngestAt: str(row.last_ingest_at),
    lastMailScanAt: str(row.last_mail_scan_at),
    sourceCursors: readCursors(row.source_cursors),
  };
}

/** The person's career row, or null when they have none yet. Missing table → null. */
export async function getCareerRow(userId: string, db?: CareerDb): Promise<CareerRow | null> {
  const client = await dbOr(db);
  const { data, error } = await client.from('career_profiles').select(PROFILE_COLUMNS).eq('user_id', userId).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw failed(error, LOAD_MESSAGE);
  }
  return data ? toCareerRow(data as Row) : null;
}

/** Whether Gmail is connected, and whether sending was allowed. Read with the service role: the table holds tokens. */
async function gmailStatus(userId: string): Promise<CareerState['gmail']> {
  try {
    const { data, error } = await createAdminClient().from('gmail_connections').select('status,granted_scopes').eq('user_id', userId).maybeSingle();
    if (error || !data) return { connected: false, canSend: false };
    const connected = data.status === 'connected';
    return { connected, canSend: connected && strings(data.granted_scopes).includes(GMAIL_SEND_SCOPE) };
  } catch (error) {
    console.error('Reading the Gmail connection for Career failed', error);
    return { connected: false, canSend: false };
  }
}

/** Everything a Career screen opens with. */
export async function getCareerState(userId: string): Promise<CareerState> {
  const client = await dbOr();
  const [result, gmail] = await Promise.all([
    client.from('career_profiles').select(PROFILE_COLUMNS).eq('user_id', userId).maybeSingle(),
    gmailStatus(userId),
  ]);
  if (result.error && !isMissingTable(result.error)) throw failed(result.error, LOAD_MESSAGE);
  const row = result.data ? toCareerRow(result.data as Row) : null;
  return {
    ready: !result.error,
    profile: row?.profile ?? null,
    spec: row?.spec ?? null,
    settings: row?.settings ?? readSettings(null),
    resumeFileName: row?.resumeName ?? null,
    gmail,
    lastIngestAt: row?.lastIngestAt ?? null,
  };
}

/**
 * Writes the person's own columns, creating the row the first time. Update
 * first, then insert: an upsert would also need update rights on user_id.
 */
async function writeProfileRow(userId: string, values: Row, db?: CareerDb) {
  const client = await dbOr(db);
  const updated = await client.from('career_profiles').update(values).eq('user_id', userId).select('user_id');
  if (updated.error) throw failed(updated.error, SAVE_MESSAGE);
  if (updated.data?.length) return;
  const inserted = await client.from('career_profiles').insert({ user_id: userId, ...values });
  if (!inserted.error) return;
  if (inserted.error.code !== '23505') throw failed(inserted.error, SAVE_MESSAGE);
  // Another request created the row in between; this one updates it.
  const retried = await client.from('career_profiles').update(values).eq('user_id', userId);
  if (retried.error) throw failed(retried.error, SAVE_MESSAGE);
}

export async function saveProfile(userId: string, profile: CareerProfile, db?: CareerDb) {
  await writeProfileRow(userId, { profile }, db);
}

export async function saveSpec(userId: string, spec: CareerSpec, db?: CareerDb) {
  await writeProfileRow(userId, { spec }, db);
}

/** Merges `patch` over the saved settings (themselves over the defaults) and returns what was saved. */
export async function saveSettings(userId: string, patch: Partial<CareerSettings>, db?: CareerDb): Promise<CareerSettings> {
  const current = (await getCareerRow(userId, db))?.settings ?? readSettings(null);
  const settings = readSettings({ ...current, ...patch, sources: { ...current.sources, ...patch.sources } });
  await writeProfileRow(userId, { settings }, db);
  return settings;
}

/** The uploaded resume: its Storage path, the name it was chosen as, and its text once read. */
export async function setResumeFile(userId: string, file: { path: string; name: string; text: string | null }, db?: CareerDb) {
  if (!ownPath(userId, file.path)) throw new CareerError('That file could not be found. Choose it again.');
  await writeProfileRow(userId, { resume_path: file.path, resume_name: file.name.slice(0, 200) || 'resume', resume_text: file.text?.slice(0, 100_000) ?? null }, db);
}

// ─── Cron bookkeeping (service role only) ─────────────────────────────────

async function writeBookkeeping(admin: CareerDb, userId: string, values: Row) {
  const { error } = await admin.from('career_profiles').update(values).eq('user_id', userId);
  if (error) throw failed(error, 'Career bookkeeping could not be saved.');
}

export async function setLastIngest(admin: CareerDb, userId: string, at = new Date().toISOString()) {
  await writeBookkeeping(admin, userId, { last_ingest_at: at });
}

export async function setLastMailScan(admin: CareerDb, userId: string, at = new Date().toISOString()) {
  await writeBookkeeping(admin, userId, { last_mail_scan_at: at });
}

/** When each source was last fetched for this person, for the polling limits. */
export async function getSourceCursors(admin: CareerDb, userId: string): Promise<Partial<Record<SourceId, string>>> {
  return (await getCareerRow(userId, admin))?.sourceCursors ?? {};
}

export async function setSourceCursor(admin: CareerDb, userId: string, source: SourceId, at = new Date().toISOString()) {
  const cursors = await getSourceCursors(admin, userId);
  await writeBookkeeping(admin, userId, { source_cursors: { ...cursors, [source]: at } });
}

/** Several sources fetched in one run: one read and one write, so parallel fetches can't lose each other's cursor. */
export async function setSourceCursors(admin: CareerDb, userId: string, sources: SourceId[], at = new Date().toISOString()) {
  if (!sources.length) return;
  const cursors = await getSourceCursors(admin, userId);
  for (const source of sources) cursors[source] = at;
  await writeBookkeeping(admin, userId, { source_cursors: cursors });
}

export type CronKind = 'ingest' | 'mail';
const CRON_COLUMN: Record<CronKind, string> = { ingest: 'last_ingest_at', mail: 'last_mail_scan_at' };

/**
 * Claims this person's run: stamps `at` only if the last run is older than
 * `staleBefore` (or never happened), in one conditional update. False means an
 * overlapping run got there first, or it is too soon.
 */
export async function claimCareerRun(admin: CareerDb, userId: string, kind: CronKind, at: string, staleBefore: string): Promise<boolean> {
  const column = CRON_COLUMN[kind];
  const { data, error } = await admin.from('career_profiles').update({ [column]: at }).eq('user_id', userId)
    .or(`${column}.is.null,${column}.lt."${staleBefore}"`).select('user_id');
  if (error) throw failed(error, 'Career bookkeeping could not be saved.');
  return Boolean(data?.length);
}

/** Gives a failed run's claim back, so the next cron tries again instead of waiting a whole interval. */
export async function releaseCareerRun(admin: CareerDb, userId: string, kind: CronKind, previous: string | null) {
  await writeBookkeeping(admin, userId, { [CRON_COLUMN[kind]]: previous });
}

/** How far ahead a refused person is stamped: past every admitted person's own stamp from the same run. */
const REFUSED_DELAY_MS = 24 * 60 * 60 * 1000;

/**
 * Stamps people a cron listed but refused (not admitted) as if their run
 * happened a day after `at`, the run's start, so they sort behind everyone the
 * run does serve (whose own stamps land minutes after `at`) instead of holding
 * the head of the list, and the LIMIT, on every run. In chunks, so a long
 * refused list never builds a URL past the gateway's limit. Best effort.
 */
export async function deferCareerUsers(admin: CareerDb, kind: CronKind, userIds: readonly string[], at: string) {
  if (!userIds.length) return;
  const stamp = new Date(Date.parse(at) + REFUSED_DELAY_MS).toISOString();
  for (const ids of chunks([...userIds])) {
    try {
      const { error } = await admin.from('career_profiles').update({ [CRON_COLUMN[kind]]: stamp }).in('user_id', ids);
      if (error) console.error('Deferring refused career profiles failed', error);
    } catch (error) {
      console.error('Deferring refused career profiles failed', error);
    }
  }
}

export type CareerUser = { userId: string; lastIngestAt: string | null; lastMailScanAt: string | null };

/** Everyone with a career profile, the longest-waiting first for the given cron. */
export async function listCareerUsers(admin: CareerDb, by: 'ingest' | 'mail' = 'ingest'): Promise<CareerUser[]> {
  const column = by === 'ingest' ? 'last_ingest_at' : 'last_mail_scan_at';
  const { data, error } = await admin.from('career_profiles').select('user_id,last_ingest_at,last_mail_scan_at')
    .order(column, { ascending: true, nullsFirst: true }).limit(1000);
  if (error) {
    if (isMissingTable(error)) return [];
    throw failed(error, 'Career users could not be listed.');
  }
  return (data ?? []).map((row) => ({ userId: String(row.user_id), lastIngestAt: str(row.last_ingest_at), lastMailScanAt: str(row.last_mail_scan_at) }));
}

// ─── Jobs ─────────────────────────────────────────────────────────────────

const JOB_COLUMNS = 'id,source,source_ref,dedupe_key,title,company,location,remote,url,apply_url,apply_email,recruitee,description,thin,salary,posted_at,sources,attribution,requirements,match,score,state,dismiss_reason,found_at';

function toJob(row: Row): CareerJob {
  const recruitee = readRecruitee(row.recruitee);
  return {
    id: String(row.id),
    source: oneOf(row.source, SOURCE_IDS) ?? 'pasted',
    sourceRef: String(row.source_ref),
    dedupeKey: String(row.dedupe_key),
    title: String(row.title),
    company: String(row.company),
    location: str(row.location),
    remote: row.remote === true,
    url: String(row.url),
    applyUrl: str(row.apply_url),
    applyEmail: str(row.apply_email),
    description: str(row.description),
    thin: row.thin === true,
    salary: readSalary(row.salary),
    postedAt: str(row.posted_at),
    attribution: str(row.attribution),
    ...(recruitee ? { recruitee } : {}),
    seenOn: readSightings(row.sources),
    requirements: readRequirements(row.requirements),
    match: readMatch(row.match),
    score: num(row.score),
    state: oneOf(row.state, JOB_STATES) ?? 'new',
    dismissReason: str(row.dismiss_reason),
    foundAt: String(row.found_at),
  };
}

/** How a new job would be applied to, before anything smarter decides. */
function routeFor(job: NormalizedJob): ApplyRoute {
  if (job.recruitee) return 'recruitee';
  if (job.applyEmail) return 'email';
  return 'link';
}

const isHttp = (url: string | null) => url !== null && url.length <= 2048 && /^https?:\/\//i.test(url);

/** What the table's checks would refuse; one bad listing must not sink its whole batch. */
function storable(job: NormalizedJob & { dedupeKey: string }) {
  return isHttp(job.url) && job.title.trim() !== '' && job.company.trim() !== '' && job.sourceRef !== '' && job.dedupeKey !== '' && job.dedupeKey.length <= 300;
}

const sightingOf = (job: NormalizedJob) => ({ source: job.source, url: job.url, attribution: job.attribution });

function newJobRow(userId: string, job: NormalizedJob & { dedupeKey: string }): Row {
  return {
    user_id: userId, source: job.source, source_ref: job.sourceRef.slice(0, 300), dedupe_key: job.dedupeKey,
    title: job.title.slice(0, 300), company: job.company.slice(0, 200), location: job.location?.slice(0, 300) ?? null, remote: job.remote,
    url: job.url, apply_url: isHttp(job.applyUrl) ? job.applyUrl : null, apply_email: job.applyEmail?.slice(0, 320) ?? null, apply_route: routeFor(job), recruitee: job.recruitee ?? null,
    description: job.description?.slice(0, 20_000) ?? null, thin: job.thin, salary: job.salary, posted_at: job.postedAt,
    sources: [sightingOf(job)], attribution: job.attribution?.slice(0, 120) ?? null,
  };
}

function storedListing(stored: Row): StoredListing {
  return {
    source: oneOf(stored.source, SOURCE_IDS), url: str(stored.url), thin: stored.thin === true,
    description: str(stored.description), applyEmail: str(stored.apply_email), applyUrl: str(stored.apply_url),
  };
}

/**
 * What a new sighting of a stored job changes: its sources, and what
 * listingPatch (lib/career/recipient.ts) allows. Another listing with the same
 * dedupe key is only recorded as a sighting: its apply address and apply page
 * are never taken, so a stranger's post can't redirect Send.
 */
function mergedJobValues(incoming: NormalizedJob, stored: Row): Row | null {
  const seenOn = readSightings(stored.sources);
  const values: Row = {};
  if (!seenOn.some((item) => item.source === incoming.source && item.url === incoming.url)) {
    values.sources = [sightingOf(incoming), ...seenOn].slice(0, MAX_SIGHTINGS);
  }
  const patch = listingPatch(incoming, storedListing(stored));
  if (patch.description !== undefined) values.description = patch.description;
  if (patch.thin !== undefined) values.thin = patch.thin;
  if (patch.applyEmail) values.apply_email = patch.applyEmail;
  if (patch.applyUrl && isHttp(patch.applyUrl)) values.apply_url = patch.applyUrl;
  if (!stored.salary && incoming.salary) values.salary = incoming.salary;
  if (!stored.posted_at && incoming.postedAt) values.posted_at = incoming.postedAt;
  return Object.keys(values).length ? values : null;
}

/**
 * Folds a batch into rows to insert (by dedupe key) and changes to stored rows
 * (by id). A key seen twice in one batch merges like a later sighting would.
 */
function planUpserts(userId: string, jobs: Array<NormalizedJob & { dedupeKey: string }>, stored: Map<string, Row>) {
  const fresh = new Map<string, Row>();
  const changed = new Map<string, Row>();
  for (const job of jobs) {
    const row = stored.get(job.dedupeKey) ?? fresh.get(job.dedupeKey);
    if (!row) {
      fresh.set(job.dedupeKey, newJobRow(userId, job));
      continue;
    }
    const values = mergedJobValues(job, row);
    if (!values) continue;
    if (stored.has(job.dedupeKey)) {
      stored.set(job.dedupeKey, { ...row, ...values });
      changed.set(String(row.id), { ...changed.get(String(row.id)), ...values });
    } else {
      fresh.set(job.dedupeKey, { ...row, ...values });
    }
  }
  return { fresh: [...fresh.values()], changed };
}

async function storedByKey(client: CareerDb, userId: string, keys: string[]) {
  const stored = new Map<string, Row>();
  for (const part of chunks(keys)) {
    const { data, error } = await client.from('career_jobs').select('id,dedupe_key,source,url,sources,description,thin,salary,apply_email,apply_url,posted_at')
      .eq('user_id', userId).in('dedupe_key', part);
    if (error) throw failed(error, 'Jobs could not be saved.');
    for (const row of (data ?? []) as Row[]) stored.set(String(row.dedupe_key), row);
  }
  return stored;
}

/**
 * Saves a batch of found jobs. A job already stored (same dedupe key) gains the
 * sighting (and only what mergedJobValues allows); the rest are inserted.
 * Returns the ids of the rows that are new.
 */
export async function upsertJobs(client: CareerDb, userId: string, jobs: Array<NormalizedJob & { dedupeKey: string }>): Promise<string[]> {
  const valid = jobs.filter(storable);
  if (!valid.length) return [];
  const stored = await storedByKey(client, userId, [...new Set(valid.map((job) => job.dedupeKey))]);
  const { fresh, changed } = planUpserts(userId, valid, stored);
  for (const [id, values] of changed) {
    const { error } = await client.from('career_jobs').update(values).eq('user_id', userId).eq('id', id); // NOSONAR: each row gets its own merged values; batches are small
    if (error) console.error('Merging a job sighting failed', error);
  }
  const ids: string[] = [];
  for (const part of chunks(fresh, 100)) {
    // A concurrent run may have inserted the same key; that row is simply not new here.
    const { data, error } = await client.from('career_jobs').upsert(part, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true }).select('id');
    if (error) throw failed(error, 'Jobs could not be saved.');
    ids.push(...(data ?? []).map((row) => String(row.id)));
  }
  return ids;
}

export type JobView = 'for_you' | 'everything' | 'shortlisted';
export type JobQuery = { view: JobView; threshold: number; limit?: number; offset?: number; search?: string };

/** Letters, digits and a few title characters only: the term goes inside a PostgREST `or` filter. */
function searchTerm(search: string | undefined) {
  return (search ?? '').replaceAll(/[^\p{L}\p{N} .+#-]/gu, ' ').replaceAll(/\s+/g, ' ').trim().slice(0, 60);
}

export async function listJobs(userId: string, query: JobQuery, db?: CareerDb): Promise<CareerJob[]> {
  const client = await dbOr(db);
  const limit = Math.min(Math.max(query.limit ?? 30, 1), 100);
  const offset = Math.max(query.offset ?? 0, 0);
  let request = client.from('career_jobs').select(JOB_COLUMNS).eq('user_id', userId);
  // For you: new, unexcluded matches at or above the bar. Everything: all but the dismissed.
  if (query.view === 'for_you') {
    request = request.eq('state', 'new').is('excluded_reason', null).gte('score', query.threshold)
      .order('score', { ascending: false }).order('found_at', { ascending: false });
  } else if (query.view === 'shortlisted') {
    request = request.eq('state', 'shortlisted').order('found_at', { ascending: false });
  } else {
    request = request.neq('state', 'dismissed').order('found_at', { ascending: false });
  }
  const term = searchTerm(query.search);
  if (term) request = request.or(`title.ilike.*${term}*,company.ilike.*${term}*`);
  const { data, error } = await request.range(offset, offset + limit - 1);
  if (error) {
    if (isMissingTable(error)) return [];
    throw failed(error, 'Jobs couldn’t be loaded. Try again in a little while.');
  }
  return ((data ?? []) as Row[]).map(toJob);
}

export type JobPageQuery = JobQuery & { source?: SourceId; remoteOnly?: boolean; minScore?: number };

/**
 * One page of a job list with the total that matches, for the Jobs views'
 * filters (source, remote only, a minimum score). For you keeps its own bar:
 * the threshold, or `minScore` when that is higher.
 */
export async function listJobsPage(userId: string, query: JobPageQuery, db?: CareerDb): Promise<{ jobs: CareerJob[]; total: number }> {
  const client = await dbOr(db);
  const limit = Math.min(Math.max(query.limit ?? 30, 1), 100);
  const offset = Math.max(query.offset ?? 0, 0);
  let request = client.from('career_jobs').select(JOB_COLUMNS, { count: 'exact' }).eq('user_id', userId);
  if (query.view === 'for_you') {
    request = request.eq('state', 'new').is('excluded_reason', null).gte('score', Math.max(query.threshold, query.minScore ?? 0));
  } else if (query.view === 'shortlisted') {
    request = request.eq('state', 'shortlisted');
  } else {
    request = request.neq('state', 'dismissed');
  }
  if (query.view !== 'for_you' && query.minScore) request = request.gte('score', query.minScore);
  if (query.source) request = request.eq('source', query.source);
  if (query.remoteOnly) request = request.eq('remote', true);
  const term = searchTerm(query.search);
  if (term) request = request.or(`title.ilike.*${term}*,company.ilike.*${term}*`);
  request = query.view === 'for_you'
    ? request.order('score', { ascending: false }).order('found_at', { ascending: false })
    : request.order('found_at', { ascending: false });
  const { data, error, count } = await request.range(offset, offset + limit - 1);
  if (error) {
    if (isMissingTable(error)) return { jobs: [], total: 0 };
    throw failed(error, 'Jobs couldn’t be loaded. Try again in a little while.');
  }
  return { jobs: ((data ?? []) as Row[]).map(toJob), total: count ?? 0 };
}

/** The stored job with this dedupe key, for a pasted job that turned out to be one already found. */
export async function findJobIdByKey(userId: string, dedupeKey: string, db?: CareerDb): Promise<string | null> {
  const client = await dbOr(db);
  const { data, error } = await client.from('career_jobs').select('id').eq('user_id', userId).eq('dedupe_key', dedupeKey).maybeSingle();
  if (error) throw failed(error, 'That job couldn’t be loaded.');
  return data ? String(data.id) : null;
}

/**
 * The full description the owner pasted for a thin job. It is no longer thin,
 * and its requirements are cleared so the next score reads them from the text.
 */
export async function setJobDescription(userId: string, jobId: string, description: string, db?: CareerDb) {
  return updateJob(userId, jobId, { description: description.slice(0, 20_000), thin: false, requirements: null, requirements_version: null }, db);
}

export async function getJob(userId: string, jobId: string, db?: CareerDb): Promise<CareerJob | null> {
  const client = await dbOr(db);
  const { data, error } = await client.from('career_jobs').select(JOB_COLUMNS).eq('user_id', userId).eq('id', jobId).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw failed(error, 'That job couldn’t be loaded.');
  }
  return data ? toJob(data as Row) : null;
}

/** Jobs not yet read for requirements, oldest first. */
export async function listJobsNeedingRequirements(client: CareerDb, userId: string, limit: number): Promise<CareerJob[]> {
  const { data, error } = await client.from('career_jobs').select(JOB_COLUMNS).eq('user_id', userId).is('requirements', null)
    .neq('state', 'dismissed').order('found_at', { ascending: true }).limit(Math.max(limit, 1));
  if (error) {
    if (isMissingTable(error)) return [];
    throw failed(error, 'Jobs couldn’t be loaded.');
  }
  return ((data ?? []) as Row[]).map(toJob);
}

/** The given jobs, in no particular order; ids that aren't this person's are simply absent. */
export async function listJobsByIds(userId: string, ids: string[], db?: CareerDb): Promise<CareerJob[]> {
  const client = await dbOr(db);
  const jobs: CareerJob[] = [];
  for (const part of chunks([...new Set(ids)])) {
    const { data, error } = await client.from('career_jobs').select(JOB_COLUMNS).eq('user_id', userId).in('id', part); // NOSONAR: chunks keep each URL short; there are rarely more than one or two
    if (error) {
      if (isMissingTable(error)) return [];
      throw failed(error, 'Jobs couldn’t be loaded.');
    }
    jobs.push(...((data ?? []) as Row[]).map(toJob));
  }
  return jobs;
}

/** Jobs never scored, newest first: the freshest listings matter most when a run can't do them all. */
export async function listUnscoredJobs(client: CareerDb, userId: string, limit: number): Promise<CareerJob[]> {
  const { data, error } = await client.from('career_jobs').select(JOB_COLUMNS).eq('user_id', userId).is('score', null)
    .neq('state', 'dismissed').order('found_at', { ascending: false }).limit(Math.max(limit, 1));
  if (error) {
    if (isMissingTable(error)) return [];
    throw failed(error, 'Jobs couldn’t be loaded.');
  }
  return ((data ?? []) as Row[]).map(toJob);
}

// Everything but the description, which is up to 20 kB a job and not needed to count or chart.
const SUMMARY_JOB_COLUMNS = 'id,source,source_ref,dedupe_key,title,company,location,remote,url,apply_url,apply_email,recruitee,thin,salary,posted_at,sources,attribution,requirements,match,score,state,dismiss_reason,found_at';

/**
 * Jobs found since `since` (ISO), newest first, WITHOUT their descriptions
 * (`description` is null on every one), for Insights and the auto-draft pick.
 */
export async function listJobsSince(userId: string, since: string, limit: number, db?: CareerDb): Promise<CareerJob[]> {
  const client = await dbOr(db);
  const { data, error } = await client.from('career_jobs').select(SUMMARY_JOB_COLUMNS).eq('user_id', userId).gte('found_at', since)
    .order('found_at', { ascending: false }).limit(Math.min(Math.max(limit, 1), 5000));
  if (error) {
    if (isMissingTable(error)) return [];
    throw failed(error, 'Jobs couldn’t be loaded.');
  }
  return ((data ?? []) as Row[]).map(toJob);
}

/** How many new, unexcluded jobs are at or above the bar: the "For you" count. */
export async function countForYou(userId: string, threshold: number, db?: CareerDb): Promise<number> {
  const client = await dbOr(db);
  const { count, error } = await client.from('career_jobs').select('id', { count: 'exact', head: true }).eq('user_id', userId)
    .eq('state', 'new').is('excluded_reason', null).gte('score', threshold);
  if (error) {
    if (isMissingTable(error)) return 0;
    throw failed(error, LOAD_MESSAGE);
  }
  return count ?? 0;
}

async function updateJob(userId: string, jobId: string, values: Row, db?: CareerDb) {
  const client = await dbOr(db);
  const { data, error } = await client.from('career_jobs').update(values).eq('user_id', userId).eq('id', jobId).select('id');
  if (error) throw failed(error, SAVE_MESSAGE);
  return Boolean(data?.length);
}

export async function setJobRequirements(userId: string, jobId: string, requirements: Requirements, db?: CareerDb) {
  return updateJob(userId, jobId, { requirements, requirements_version: requirements.version }, db);
}

/** The score (0–100, null to clear), the match behind it, and the hard filter that excluded it, if any. */
export async function setJobMatch(userId: string, jobId: string, value: { score: number | null; match: Match | null; excluded: string | null }, db?: CareerDb) {
  const score = value.score === null ? null : Math.min(Math.max(Math.round(value.score), 0), 100);
  return updateJob(userId, jobId, { score, match: value.match, excluded_reason: value.excluded?.slice(0, 300) ?? null }, db);
}

export async function setJobState(userId: string, jobId: string, state: JobState, dismissReason: string | null = null, db?: CareerDb) {
  const reason = state === 'dismissed' ? dismissReason?.trim().slice(0, 300) || null : null;
  return updateJob(userId, jobId, { state, dismiss_reason: reason }, db);
}

// ─── Applications ─────────────────────────────────────────────────────────

const APPLICATION_COLUMNS = 'id,job_id,status,route,draft,cover_note,answers,outreach,removed,ats,resume_pdf_path,resume_docx_path,sent_at,gmail_thread_id,company_domains,follow_up_due,follow_up_draft,prediction,prep,last_event_at,notes,updated_at';

const readDraft = (value: unknown) =>
  shaped<TailoredDraft>(value, (row) => typeof row.headline === 'string' && isRecord(row.summary) && hasArrays(row, ['skills', 'roles', 'projects']));
const readCited = (value: unknown) => shaped<CitedText>(value, (row) => typeof row.text === 'string' && Array.isArray(row.factIds));
const readAts = (value: unknown) => shaped<AtsReport>(value, (row) => typeof row.passed === 'boolean' && Array.isArray(row.checks));
const readPrediction = (value: unknown) => shaped<Prediction>(value, (row) => num(row.reply) !== null && num(row.interview) !== null);
const readPrep = (value: unknown) =>
  shaped<InterviewPrep>(value, (row) => isRecord(row.logistics) && hasArrays(row, ['likelyTopics', 'questionsToAsk', 'gaps']));

function toApplication(row: Row): CareerApplication {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    status: oneOf(row.status, APPLICATION_STATUSES) ?? 'drafting',
    route: oneOf(row.route, ROUTES) ?? 'link',
    draft: readDraft(row.draft),
    coverNote: readCited(row.cover_note),
    answers: listOf<ScreeningAnswer>(row.answers, (item) => hasStrings(item, ['question', 'answer'])),
    outreach: str(row.outreach),
    removed: listOf<TruthRemoval>(row.removed, (item) => hasStrings(item, ['where', 'text', 'reason'])),
    ats: readAts(row.ats),
    hasPdf: typeof row.resume_pdf_path === 'string',
    hasDocx: typeof row.resume_docx_path === 'string',
    sentAt: str(row.sent_at),
    gmailThreadId: str(row.gmail_thread_id),
    companyDomains: strings(row.company_domains),
    followUpDue: str(row.follow_up_due),
    followUpDraft: str(row.follow_up_draft),
    prediction: readPrediction(row.prediction),
    prep: readPrep(row.prep),
    lastEventAt: str(row.last_event_at),
    notes: str(row.notes),
    updatedAt: String(row.updated_at),
  };
}

/** What may change on an application. `pdfPath`/`docxPath` are the tailored files' Storage paths. */
export type ApplicationPatch = Partial<{
  status: ApplicationStatus;
  route: ApplyRoute;
  draft: TailoredDraft | null;
  coverNote: CitedText | null;
  answers: ScreeningAnswer[];
  outreach: string | null;
  removed: TruthRemoval[];
  ats: AtsReport | null;
  pdfPath: string | null;
  docxPath: string | null;
  sentAt: string | null;
  gmailThreadId: string | null;
  companyDomains: string[];
  followUpDue: string | null;
  /** The follow-up the watcher drafted, waiting for the owner's Send. */
  followUpDraft: string | null;
  prediction: Prediction | null;
  prep: InterviewPrep | null;
  lastEventAt: string | null;
  notes: string | null;
}>;

const PATCH_COLUMNS: Record<keyof ApplicationPatch, string> = {
  status: 'status', route: 'route', draft: 'draft', coverNote: 'cover_note', answers: 'answers', outreach: 'outreach',
  removed: 'removed', ats: 'ats', pdfPath: 'resume_pdf_path', docxPath: 'resume_docx_path', sentAt: 'sent_at',
  gmailThreadId: 'gmail_thread_id', companyDomains: 'company_domains', followUpDue: 'follow_up_due', followUpDraft: 'follow_up_draft', prediction: 'prediction',
  prep: 'prep', lastEventAt: 'last_event_at', notes: 'notes',
};

function patchValues(patch: ApplicationPatch): Row {
  const values: Row = {};
  for (const [key, column] of Object.entries(PATCH_COLUMNS)) {
    const value = patch[key as keyof ApplicationPatch];
    if (value !== undefined) values[column] = value;
  }
  return values;
}

export type NewApplication = ApplicationPatch & { jobId: string; route: ApplyRoute };

/** Creates the application for a job. There is one per job, so a second call returns the first. */
export async function createApplication(userId: string, input: NewApplication, db?: CareerDb): Promise<CareerApplication> {
  const client = await dbOr(db);
  const { jobId, ...patch } = input;
  const { data, error } = await client.from('career_applications').insert({ user_id: userId, job_id: jobId, ...patchValues(patch) }).select(APPLICATION_COLUMNS).single();
  if (!error && data) return toApplication(data as Row);
  if (error?.code === '23505') {
    const existing = await getApplicationForJob(userId, jobId, client);
    if (existing) return existing;
  }
  throw failed(error ?? {}, 'The application couldn’t be started. Try again in a little while.');
}

async function oneApplication(client: CareerDb, userId: string, column: 'id' | 'job_id', value: string) {
  const { data, error } = await client.from('career_applications').select(APPLICATION_COLUMNS).eq('user_id', userId).eq(column, value).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw failed(error, 'That application couldn’t be loaded.');
  }
  return data ? toApplication(data as Row) : null;
}

export async function getApplication(userId: string, applicationId: string, db?: CareerDb) {
  return oneApplication(await dbOr(db), userId, 'id', applicationId);
}

export async function getApplicationForJob(userId: string, jobId: string, db?: CareerDb) {
  return oneApplication(await dbOr(db), userId, 'job_id', jobId);
}

/** The tailored files' Storage paths, for a download or an attachment. */
export async function getApplicationFiles(userId: string, applicationId: string, db?: CareerDb): Promise<{ pdfPath: string | null; docxPath: string | null } | null> {
  const client = await dbOr(db);
  const { data, error } = await client.from('career_applications').select('resume_pdf_path,resume_docx_path').eq('user_id', userId).eq('id', applicationId).maybeSingle();
  if (error) throw failed(error, 'That application couldn’t be loaded.');
  return data ? { pdfPath: str(data.resume_pdf_path), docxPath: str(data.resume_docx_path) } : null;
}

export async function listApplications(userId: string, options: { statuses?: ApplicationStatus[]; limit?: number } = {}, db?: CareerDb): Promise<CareerApplication[]> {
  const client = await dbOr(db);
  let request = client.from('career_applications').select(APPLICATION_COLUMNS).eq('user_id', userId);
  if (options.statuses?.length) request = request.in('status', options.statuses);
  const { data, error } = await request.order('updated_at', { ascending: false }).limit(Math.min(Math.max(options.limit ?? 500, 1), 1000));
  if (error) {
    if (isMissingTable(error)) return [];
    throw failed(error, 'Applications couldn’t be loaded. Try again in a little while.');
  }
  return ((data ?? []) as Row[]).map(toApplication);
}

/** Applies `patch`; null when there is no such application. */
export async function updateApplication(userId: string, applicationId: string, patch: ApplicationPatch, db?: CareerDb): Promise<CareerApplication | null> {
  const values = patchValues(patch);
  if (!Object.keys(values).length) return getApplication(userId, applicationId, db);
  const client = await dbOr(db);
  const { data, error } = await client.from('career_applications').update(values).eq('user_id', userId).eq('id', applicationId).select(APPLICATION_COLUMNS).maybeSingle();
  if (error) throw failed(error, SAVE_MESSAGE);
  return data ? toApplication(data as Row) : null;
}

/**
 * Moves an application to `to` only if it is still in one of `from`, in one
 * conditional update. False means another request moved it first, which is
 * what makes a double-pressed Send send once.
 */
export async function transitionApplication(client: CareerDb, userId: string, applicationId: string, from: ApplicationStatus[], to: ApplicationStatus, patch: ApplicationPatch = {}): Promise<boolean> {
  if (!from.length) return false;
  const { data, error } = await client.from('career_applications').update({ ...patchValues(patch), status: to })
    .eq('user_id', userId).eq('id', applicationId).in('status', from).select('id');
  if (error) throw failed(error, SAVE_MESSAGE);
  return Boolean(data?.length);
}

/** How many applications were sent since `since` (ISO), for the daily cap. */
export async function countSentSince(userId: string, since: string, db?: CareerDb): Promise<number> {
  const client = await dbOr(db);
  const { count, error } = await client.from('career_applications').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('sent_at', since);
  if (error) throw failed(error, LOAD_MESSAGE);
  return count ?? 0;
}

// ─── Events ───────────────────────────────────────────────────────────────

const EVENT_COLUMNS = 'id,application_id,kind,at,summary,details,gmail_message_id';
/** details.kind of the events claimSendLock writes. */
const SEND_LOCK = 'send_lock';

function toEvent(row: Row): CareerEvent {
  return {
    id: String(row.id),
    applicationId: str(row.application_id),
    kind: oneOf(row.kind, EVENT_KINDS) ?? 'note',
    at: String(row.at),
    summary: String(row.summary),
    details: isRecord(row.details) ? row.details : {},
    gmailMessageId: str(row.gmail_message_id),
  };
}

export type NewEvent = { applicationId: string | null; kind: EventKind; summary: string; at?: string; details?: Record<string, unknown>; gmailMessageId?: string | null };

/** Keeps the application's last_event_at at its newest event. */
async function touchApplication(client: CareerDb, userId: string, applicationId: string, at: string) {
  const { error } = await client.from('career_applications').update({ last_event_at: at })
    .eq('user_id', userId).eq('id', applicationId).or(`last_event_at.is.null,last_event_at.lt."${at}"`);
  if (error) console.error('Updating an application’s last event failed', error);
}

/**
 * Records an event. A Gmail message already recorded (unique per person) is
 * not an error: it returns null, so the watcher can run twice safely.
 */
export async function addEvent(userId: string, event: NewEvent, db?: CareerDb): Promise<CareerEvent | null> {
  const client = await dbOr(db);
  const at = new Date(event.at ?? Date.now()).toISOString();
  const values: Row = {
    user_id: userId, application_id: event.applicationId, kind: event.kind, at,
    summary: event.summary.trim().slice(0, 300) || event.kind, details: event.details ?? {},
  };
  // Only the watcher (service role) records which message an event came from.
  if (event.gmailMessageId) values.gmail_message_id = event.gmailMessageId;
  const { data, error } = await client.from('career_events').insert(values).select(EVENT_COLUMNS).single();
  if (error?.code === '23505') return null;
  if (error || !data) throw failed(error ?? {}, SAVE_MESSAGE);
  if (event.applicationId) await touchApplication(client, userId, event.applicationId, at);
  return toEvent(data as Row);
}

/** Newest first. `unmatched` lists the replies not yet linked to an application. */
export async function listEvents(userId: string, options: { applicationId?: string; unmatched?: boolean; limit?: number } = {}, db?: CareerDb): Promise<CareerEvent[]> {
  const client = await dbOr(db);
  let request = client.from('career_events').select(EVENT_COLUMNS).eq('user_id', userId);
  if (options.applicationId) request = request.eq('application_id', options.applicationId);
  else if (options.unmatched) request = request.is('application_id', null);
  const { data, error } = await request.order('at', { ascending: false }).limit(Math.min(Math.max(options.limit ?? 100, 1), 1000));
  if (error) {
    if (isMissingTable(error)) return [];
    throw failed(error, 'The timeline couldn’t be loaded.');
  }
  // A send lock (claimSendLock) is bookkeeping, not something that happened.
  return ((data ?? []) as Row[]).map(toEvent).filter((event) => event.details.kind !== SEND_LOCK);
}

/** The addresses earlier applications were emailed to, for "Orbis hasn't sent here before". */
export async function sentAddresses(userId: string, db?: CareerDb): Promise<string[]> {
  const client = await dbOr(db);
  const { data, error } = await client.from('career_events').select('details').eq('user_id', userId).eq('kind', 'sent')
    .order('at', { ascending: false }).limit(1000);
  if (error) {
    if (isMissingTable(error)) return [];
    throw failed(error, LOAD_MESSAGE);
  }
  return ((data ?? []) as Row[]).flatMap((row) => {
    const to = isRecord(row.details) ? str(row.details.to) : null;
    return to ? [to] : [];
  });
}

/**
 * Sets what an attached reply turned out to be once it was read (it was
 * recorded unread). Service role: the owner may only move an event's link.
 */
export async function reclassifyEvent(admin: CareerDb, userId: string, eventId: string, value: { kind: EventKind; summary: string; details: Record<string, unknown> }) {
  const { error } = await admin.from('career_events').update({ kind: value.kind, summary: value.summary.trim().slice(0, 300) || value.kind, details: value.details })
    .eq('user_id', userId).eq('id', eventId);
  if (error) throw failed(error, SAVE_MESSAGE);
}

// ─── Send locks ───────────────────────────────────────────────────────────

const lockId = (key: string) => `orbis-lock:${key}`.slice(0, 100);

async function insertLock(admin: CareerDb, userId: string, key: string, applicationId: string, at: string) {
  const { error } = await admin.from('career_events').insert({
    user_id: userId, application_id: applicationId, kind: 'note', at, summary: 'Sending', details: { kind: SEND_LOCK }, gmail_message_id: lockId(key),
  });
  if (error && error.code !== '23505') throw failed(error, SAVE_MESSAGE);
  return !error;
}

/**
 * One send at a time for `key` (a follow-up, an offer reply): an insert on
 * the events table's unique Gmail-message key, so two presses can't both get
 * past it. A lock older than `staleBefore` was left by a request that died and
 * is taken over. Service role, as only it writes that key.
 */
export async function claimSendLock(userId: string, key: string, applicationId: string, now: Date, staleBefore: string): Promise<boolean> {
  const admin = createAdminClient();
  if (await insertLock(admin, userId, key, applicationId, now.toISOString())) return true;
  const { data, error } = await admin.from('career_events').delete().eq('user_id', userId).eq('gmail_message_id', lockId(key)).lt('at', staleBefore).select('id');
  if (error) throw failed(error, SAVE_MESSAGE);
  if (!data?.length) return false;
  return insertLock(admin, userId, key, applicationId, now.toISOString());
}

/** Lets the next send for `key` through. Never throws: a stuck lock goes stale on its own. */
export async function releaseSendLock(userId: string, key: string) {
  try {
    const { error } = await createAdminClient().from('career_events').delete().eq('user_id', userId).eq('gmail_message_id', lockId(key));
    if (error) console.error('Releasing a send lock failed', error);
  } catch (error) {
    console.error('Releasing a send lock failed', error);
  }
}

/** Attaches an unmatched reply to an application. */
export async function linkEvent(userId: string, eventId: string, applicationId: string, db?: CareerDb) {
  const client = await dbOr(db);
  const { data, error } = await client.from('career_events').update({ application_id: applicationId }).eq('user_id', userId).eq('id', eventId).is('application_id', null).select('id');
  if (error) throw failed(error, SAVE_MESSAGE);
  return Boolean(data?.length);
}

// ─── Offers ───────────────────────────────────────────────────────────────

const OFFER_COLUMNS = 'id,application_id,compensation,confirmed,advice,created_at';
const EMPTY_TERMS: OfferTerms = { fixed: null, variable: null, joiningBonus: null, equity: null, currency: null, period: null, startDate: null, deadline: null };

function readTerms(value: unknown): OfferTerms {
  if (!isRecord(value)) return EMPTY_TERMS;
  return {
    fixed: num(value.fixed), variable: num(value.variable), joiningBonus: num(value.joiningBonus), equity: str(value.equity),
    currency: str(value.currency), period: oneOf(value.period, PERIODS), startDate: str(value.startDate), deadline: str(value.deadline),
  };
}

const readAdvice = (value: unknown) =>
  shaped<OfferAdvice>(value, (row) => oneOf(row.verdict, VERDICTS) !== null && typeof row.replyDraft === 'string' && hasArrays(row, ['reasons', 'asks', 'risks']));

function toOffer(row: Row): CareerOffer {
  return {
    id: String(row.id),
    applicationId: String(row.application_id),
    terms: readTerms(row.compensation),
    confirmed: row.confirmed === true,
    advice: readAdvice(row.advice),
    createdAt: String(row.created_at),
  };
}

export async function createOffer(userId: string, input: { applicationId: string; terms: OfferTerms; confirmed?: boolean }, db?: CareerDb): Promise<CareerOffer> {
  const client = await dbOr(db);
  const { data, error } = await client.from('career_offers')
    .insert({ user_id: userId, application_id: input.applicationId, compensation: input.terms, confirmed: input.confirmed ?? false })
    .select(OFFER_COLUMNS).single();
  if (error || !data) throw failed(error ?? {}, 'The offer couldn’t be saved. Try again in a little while.');
  return toOffer(data as Row);
}

export async function getOffer(userId: string, offerId: string, db?: CareerDb): Promise<CareerOffer | null> {
  const client = await dbOr(db);
  const { data, error } = await client.from('career_offers').select(OFFER_COLUMNS).eq('user_id', userId).eq('id', offerId).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw failed(error, 'That offer couldn’t be loaded.');
  }
  return data ? toOffer(data as Row) : null;
}

export async function listOffers(userId: string, options: { applicationId?: string } = {}, db?: CareerDb): Promise<CareerOffer[]> {
  const client = await dbOr(db);
  let request = client.from('career_offers').select(OFFER_COLUMNS).eq('user_id', userId);
  if (options.applicationId) request = request.eq('application_id', options.applicationId);
  const { data, error } = await request.order('created_at', { ascending: false }).limit(200);
  if (error) {
    if (isMissingTable(error)) return [];
    throw failed(error, 'Offers couldn’t be loaded.');
  }
  return ((data ?? []) as Row[]).map(toOffer);
}

export async function updateOffer(userId: string, offerId: string, patch: { terms?: OfferTerms; confirmed?: boolean; advice?: OfferAdvice | null }, db?: CareerDb): Promise<CareerOffer | null> {
  const values: Row = {};
  if (patch.terms) values.compensation = patch.terms;
  if (patch.confirmed !== undefined) values.confirmed = patch.confirmed;
  if (patch.advice !== undefined) values.advice = patch.advice;
  if (!Object.keys(values).length) return getOffer(userId, offerId, db);
  const client = await dbOr(db);
  const { data, error } = await client.from('career_offers').update(values).eq('user_id', userId).eq('id', offerId).select(OFFER_COLUMNS).maybeSingle();
  if (error) throw failed(error, SAVE_MESSAGE);
  return data ? toOffer(data as Row) : null;
}

// ─── Mail bookkeeping (service role only) ─────────────────────────────────

export type MailOutcome = 'alert' | 'reply' | 'skipped';

/** Which of these Gmail message ids the watcher has already handled. */
export async function seenMessageIds(client: CareerDb, userId: string, ids: string[]): Promise<Set<string>> {
  const seen = new Set<string>();
  for (const part of chunks([...new Set(ids)], 100)) {
    const { data, error } = await client.from('career_mail').select('message_id').eq('user_id', userId).in('message_id', part);
    if (error) throw failed(error, 'Career mail could not be checked.');
    for (const row of data ?? []) seen.add(String(row.message_id));
  }
  return seen;
}

/** Marks messages handled, once each; one already marked keeps its first outcome. */
export async function markMailSeen(client: CareerDb, userId: string, messages: Array<{ id: string; outcome: MailOutcome }>) {
  if (!messages.length) return;
  const rows = messages.map((message) => ({ user_id: userId, message_id: message.id, outcome: message.outcome }));
  const { error } = await client.from('career_mail').upsert(rows, { onConflict: 'user_id,message_id', ignoreDuplicates: true });
  if (error) throw failed(error, 'Career mail could not be marked.');
}

/** The watcher reads 3 days back, so a record older than this is never consulted again. */
export async function pruneCareerMail(admin: CareerDb, olderThanDays = 14) {
  const before = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  const { error } = await admin.from('career_mail').delete().lt('processed_at', before);
  if (error) console.error('Pruning career mail failed', error);
}

// ─── Storage ──────────────────────────────────────────────────────────────

/** A path in this person's own folder, with no way out of it. */
function ownPath(userId: string, path: string) {
  return path.startsWith(`${userId}/`) && !path.split('/').some((part) => part === '..' || part === '');
}

/** Where a tailored file lives: `<userId>/applications/<applicationId>/resume-<n>.<format>`. */
export function applicationFilePath(userId: string, applicationId: string, version: number, format: 'pdf' | 'docx') {
  return `${userId}/applications/${applicationId}/resume-${Math.max(1, Math.trunc(version))}.${format}`;
}

export async function uploadCareerFile(client: CareerDb, userId: string, path: string, bytes: Uint8Array | ArrayBuffer | Blob, contentType: string) {
  if (!ownPath(userId, path)) throw new CareerError('That file can’t be saved there.');
  const { error } = await client.storage.from(CAREER_BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) {
    console.error('Uploading a career file failed', error);
    throw new CareerError('The file couldn’t be saved. Try again in a little while.');
  }
}

/** A short-lived link to one of the person's files; `download` names the saved file. Null when it can't be signed. */
export async function signedCareerUrl(userId: string, path: string, options: { download?: string; seconds?: number } = {}, db?: CareerDb): Promise<string | null> {
  if (!ownPath(userId, path)) return null;
  const client = await dbOr(db);
  const { data, error } = await client.storage.from(CAREER_BUCKET).createSignedUrl(path, options.seconds ?? SIGNED_URL_SECONDS, options.download ? { download: options.download } : undefined);
  if (error || !data?.signedUrl) {
    console.error('Signing a career file failed', error);
    return null;
  }
  return data.signedUrl;
}

export async function downloadCareerFile(userId: string, path: string, db?: CareerDb): Promise<Uint8Array> {
  if (!ownPath(userId, path)) throw new CareerError('That file could not be found.');
  const client = await dbOr(db);
  const { data, error } = await client.storage.from(CAREER_BUCKET).download(path);
  if (error || !data) throw new CareerError('That file could not be found. It may need to be made again.');
  return new Uint8Array(await data.arrayBuffer());
}
