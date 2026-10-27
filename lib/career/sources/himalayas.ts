/**
 * Career source: Himalayas (remote jobs), via its public search API.
 * Credit "via Himalayas"; re-synced daily at most (see SOURCES).
 */
import type { NormalizedJob } from '../types.ts';
import { asArray, asRecord, num, periodOf, salaryOf, str, toDescription, toIso, type Raw } from './common.ts';
import { getJson } from './http.ts';
import type { SourceQuery } from './index.ts';

export const HIMALAYAS_ATTRIBUTION = 'via Himalayas';
const SEARCH = 'https://himalayas.app/jobs/api/search';
/** Each role is one call; three keeps a daily sync small. */
const MAX_ROLES = 3;

function toJob(entry: Raw): NormalizedJob | null {
  const title = str(entry.title);
  const company = str(entry.companyName);
  const url = str(entry.guid) || str(entry.applicationLink);
  if (!title || !company || !url) return null;
  const places = asArray(entry.locationRestrictions).map(str).filter(Boolean);
  return {
    source: 'himalayas',
    sourceRef: url,
    title,
    company,
    location: places.length ? places.join(', ') : 'Anywhere',
    // Himalayas lists remote jobs only.
    remote: true,
    url,
    applyUrl: str(entry.applicationLink) || null,
    applyEmail: null,
    description: toDescription(str(entry.description) || str(entry.excerpt)),
    thin: false,
    salary: salaryOf(num(entry.minSalary), num(entry.maxSalary), str(entry.currency), periodOf(entry.salaryPeriod)),
    postedAt: toIso(entry.pubDate),
    attribution: HIMALAYAS_ATTRIBUTION,
  };
}

/** The jobs in one search reply. */
export function parseHimalayas(raw: unknown): NormalizedJob[] {
  return asArray(asRecord(raw)?.jobs).flatMap((entry) => {
    const record = asRecord(entry);
    const job = record ? toJob(record) : null;
    return job ? [job] : [];
  });
}

export async function fetchHimalayas(query: SourceQuery): Promise<NormalizedJob[]> {
  const key = query.env.HIMALAYAS_API_KEY;
  // The key format isn't documented publicly; a bearer token is the usual shape.
  const headers = key ? { Authorization: `Bearer ${key}` } : undefined;
  const jobs: NormalizedJob[] = [];
  for (const role of query.roles.slice(0, MAX_ROLES)) {
    const raw = await getJson(`${SEARCH}?q=${encodeURIComponent(role)}`, { headers });
    jobs.push(...parseHimalayas(raw));
  }
  return jobs;
}
