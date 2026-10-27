/**
 * Career: the job-source registry, which of them are due, and reading a
 * pasted job link.
 *
 * LinkedIn, Indeed, Naukri, Instahyre, Foundit, Wellfound, Cutshort and
 * Hirist are deliberately absent: they are read only from the owner's alert
 * emails (lib/career/alerts.ts) and never fetched (see the spec's Anti-goals).
 */
import type { NormalizedJob, SourceId, WatchedCompany } from '../types.ts';
import { ADZUNA_ATTRIBUTION, fetchAdzuna } from './adzuna.ts';
import { fetchAshby, fetchAshbyJob } from './ashby.ts';
import { fetchGreenhouse, fetchGreenhouseJob } from './greenhouse.ts';
import { fetchHimalayas, HIMALAYAS_ATTRIBUTION } from './himalayas.ts';
import { fetchHn, HN_ATTRIBUTION } from './hn.ts';
import { fetchJobspresso, JOBSPRESSO_ATTRIBUTION } from './jobspresso.ts';
import { fetchLever, fetchLeverJob } from './lever.ts';
import { fetchRecruitee, fetchRecruiteeJob } from './recruitee.ts';
import { fetchRemoteOk, REMOTEOK_ATTRIBUTION } from './remoteok.ts';
import { fetchRemotive, REMOTIVE_ATTRIBUTION } from './remotive.ts';
import { fetchWwr, WWR_ATTRIBUTION } from './wwr.ts';

export type SourceQuery = {
  /** The spec's target roles, searched for where a source can search. */
  roles: string[];
  /** Adzuna country codes ('in', 'gb'…). */
  countries: string[];
  watchlist: WatchedCompany[];
  env: Record<string, string | undefined>;
};

export type SourceDef = {
  id: SourceId;
  label: string;
  /** The credit a job from here carries on screen; null for a company's own board. */
  attribution: string | null;
  /** Env variables the source stands down without. */
  needsEnv?: string[];
  /** The least time between two fetches, from each source's terms. */
  minIntervalHours: number;
  /** Never throws; an empty list on any failure. */
  fetch: (query: SourceQuery) => Promise<NormalizedJob[]>;
};

/** A fetch that can't throw, so one failing source never stops the others. */
function safe(load: (query: SourceQuery) => Promise<NormalizedJob[]>) {
  return async (query: SourceQuery) => {
    try {
      return await load(query);
    } catch {
      return [];
    }
  };
}

export const SOURCES: SourceDef[] = [
  // Himalayas asks for a daily re-sync at most.
  { id: 'himalayas', label: 'Himalayas', attribution: HIMALAYAS_ATTRIBUTION, minIntervalHours: 24, fetch: safe(fetchHimalayas) },
  // Remotive allows four fetches a day, and each run makes one.
  { id: 'remotive', label: 'Remotive', attribution: REMOTIVE_ATTRIBUTION, minIntervalHours: 6, fetch: safe(fetchRemotive) },
  { id: 'remoteok', label: 'Remote OK', attribution: REMOTEOK_ATTRIBUTION, minIntervalHours: 3, fetch: safe(fetchRemoteOk) },
  { id: 'wwr', label: 'We Work Remotely', attribution: WWR_ATTRIBUTION, minIntervalHours: 3, fetch: safe(fetchWwr) },
  { id: 'jobspresso', label: 'Jobspresso', attribution: JOBSPRESSO_ATTRIBUTION, minIntervalHours: 3, fetch: safe(fetchJobspresso) },
  // One thread a month, and the whole thread is read each time; twice as far apart is plenty.
  { id: 'hn', label: 'Hacker News: Who is hiring', attribution: HN_ATTRIBUTION, minIntervalHours: 6, fetch: safe(fetchHn) },
  { id: 'adzuna', label: 'Adzuna', attribution: ADZUNA_ATTRIBUTION, needsEnv: ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY'], minIntervalHours: 3, fetch: safe(fetchAdzuna) },
  { id: 'greenhouse', label: 'Greenhouse', attribution: null, minIntervalHours: 3, fetch: safe(fetchGreenhouse) },
  { id: 'lever', label: 'Lever', attribution: null, minIntervalHours: 3, fetch: safe(fetchLever) },
  { id: 'ashby', label: 'Ashby', attribution: null, minIntervalHours: 3, fetch: safe(fetchAshby) },
  { id: 'recruitee', label: 'Recruitee', attribution: null, minIntervalHours: 3, fetch: safe(fetchRecruitee) },
];

/** The cron runs every 3 hours and never starts on the dot; this much early still counts. */
const SLACK_MS = 10 * 60_000;
const HOUR_MS = 3_600_000;

function lastFetch(cursors: Record<string, string>, id: SourceId) {
  const at = cursors[id] ? Date.parse(cursors[id]) : Number.NaN;
  return Number.isNaN(at) ? 0 : at;
}

/**
 * The sources to fetch now, least recently fetched first: switched on, past
 * their interval since the cursor (an ISO time per source id), and, when
 * `env` is given, with the env they need.
 */
export function sourcesDue(
  cursors: Record<string, string>,
  now: Date,
  enabled: Partial<Record<SourceId, boolean>>,
  env?: Record<string, string | undefined>,
): SourceDef[] {
  const nowMs = now.getTime();
  return SOURCES
    .filter((source) => enabled[source.id] === true)
    .filter((source) => !env || (source.needsEnv ?? []).every((name) => Boolean(env[name])))
    .filter((source) => nowMs - lastFetch(cursors, source.id) >= source.minIntervalHours * HOUR_MS - SLACK_MS)
    .sort((a, b) => lastFetch(cursors, a.id) - lastFetch(cursors, b.id));
}

// ─── Pasted links ────────────────────────────────────────────────────────

export type PastedRef =
  | { kind: 'greenhouse'; token: string; id: string }
  | { kind: 'lever'; site: string; id: string; eu: boolean }
  | { kind: 'ashby'; board: string; id: string }
  | { kind: 'recruitee'; company: string; slug: string };

const GREENHOUSE_HOSTS = new Set(['boards.greenhouse.io', 'job-boards.greenhouse.io']);
const LEVER_HOSTS = new Set(['jobs.lever.co', 'jobs.eu.lever.co']);

function parseUrl(text: string) {
  try {
    const url = new URL(text.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function greenhouseRef(url: URL, parts: string[]): PastedRef | null {
  // The embedded form: /embed/job_app?for=<token>&token=<id>.
  if (parts[0] === 'embed') {
    const token = url.searchParams.get('for');
    const id = url.searchParams.get('token');
    return token && id && /^\d+$/.test(id) ? { kind: 'greenhouse', token, id } : null;
  }
  const [token, jobs, id] = parts;
  return token && jobs === 'jobs' && id && /^\d+$/.test(id) ? { kind: 'greenhouse', token, id } : null;
}

function recruiteeRef(host: string, parts: string[]): PastedRef | null {
  const company = host.slice(0, -'.recruitee.com'.length);
  const offer = parts.indexOf('o');
  const slug = offer === -1 ? '' : parts[offer + 1];
  return company && !company.includes('.') && slug ? { kind: 'recruitee', company, slug } : null;
}

/** Which ATS a pasted job link belongs to, with what's needed to read it from that ATS's API. Null for anything else. */
export function pastedUrlKind(text: string): PastedRef | null {
  const url = parseUrl(text);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  if (GREENHOUSE_HOSTS.has(host)) return greenhouseRef(url, parts);
  if (LEVER_HOSTS.has(host) && parts.length >= 2) return { kind: 'lever', site: parts[0], id: parts[1], eu: host === 'jobs.eu.lever.co' };
  if (host === 'jobs.ashbyhq.com' && parts.length >= 2) return { kind: 'ashby', board: parts[0], id: parts[1] };
  if (host.endsWith('.recruitee.com')) return recruiteeRef(host, parts);
  return null;
}

/**
 * The job behind a pasted Greenhouse, Lever, Ashby or Recruitee link, read
 * from that ATS's public API. Any other link (LinkedIn, Indeed, Naukri, a
 * company page) returns null without being fetched: it is only an apply link,
 * and the owner pastes the text.
 */
export async function fetchPastedJob(text: string): Promise<NormalizedJob | null> {
  const ref = pastedUrlKind(text);
  try {
    switch (ref?.kind) {
      case 'greenhouse': return await fetchGreenhouseJob(ref.token, ref.id);
      case 'lever': return await fetchLeverJob(ref.site, ref.id, ref.eu);
      case 'ashby': return await fetchAshbyJob(ref.board, ref.id);
      case 'recruitee': return await fetchRecruiteeJob(ref.company, ref.slug);
      default: return null;
    }
  } catch {
    return null;
  }
}
