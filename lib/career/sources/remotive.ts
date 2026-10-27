/**
 * Career source: Remotive, via its public API. Credit "via Remotive" and link
 * back. Remotive asks for at most four fetches a day, so each run makes ONE
 * request (SOURCES spaces runs six hours apart).
 */
import type { NormalizedJob } from '../types.ts';
import { asArray, asRecord, str, toDescription, toIso, type Raw } from './common.ts';
import { getJson } from './http.ts';
import type { SourceQuery } from './index.ts';
import { parseSalaryText } from './salary.ts';

export const REMOTIVE_ATTRIBUTION = 'via Remotive';
const API = 'https://remotive.com/api/remote-jobs';

function toJob(entry: Raw): NormalizedJob | null {
  const title = str(entry.title);
  const company = str(entry.company_name);
  const url = str(entry.url);
  const id = str(entry.id);
  if (!title || !company || !url || !id) return null;
  const salaryText = str(entry.salary);
  return {
    source: 'remotive',
    sourceRef: id,
    title,
    company,
    location: str(entry.candidate_required_location) || 'Anywhere',
    remote: true,
    url,
    applyUrl: null,
    applyEmail: null,
    description: toDescription(str(entry.description)),
    thin: false,
    // Remotive's salary is free text; most listings are in US dollars.
    salary: salaryText ? parseSalaryText(salaryText, { currency: 'USD' }) : null,
    // Its timestamps carry no zone; they are UTC.
    postedAt: toIso(utc(str(entry.publication_date))),
    attribution: REMOTIVE_ATTRIBUTION,
  };
}

/** "2026-10-22T18:40:19" read as UTC rather than local time. */
function utc(stamp: string) {
  if (!stamp || stamp.endsWith('Z') || stamp.includes('+')) return stamp;
  return `${stamp}Z`;
}

export function parseRemotive(raw: unknown): NormalizedJob[] {
  return asArray(asRecord(raw)?.jobs).flatMap((entry) => {
    const record = asRecord(entry);
    const job = record ? toJob(record) : null;
    return job ? [job] : [];
  });
}

/**
 * One request a run: a search for the role when there is exactly one, else
 * the whole list, which the prefilter narrows. One search per role would
 * break the four-a-day limit.
 */
export function remotiveUrl(roles: string[]) {
  return roles.length === 1 ? `${API}?search=${encodeURIComponent(roles[0])}` : API;
}

export async function fetchRemotive(query: SourceQuery): Promise<NormalizedJob[]> {
  return parseRemotive(await getJson(remotiveUrl(query.roles), { timeoutMs: 20_000 }));
}
