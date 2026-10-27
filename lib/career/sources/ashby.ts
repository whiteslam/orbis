/**
 * Career source: Ashby job boards (company watchlist and pasted links), via
 * the public Posting API with compensation. Ashby doesn't send the company
 * name, so it comes from the watchlist (or the board name).
 */
import type { NormalizedJob } from '../types.ts';
import { asArray, asRecord, eachWatched, looksRemote, num, periodOf, salaryOf, str, titleFromSlug, toDescription, toIso, type Raw } from './common.ts';
import { getJson } from './http.ts';
import type { SourceQuery } from './index.ts';

const API = 'https://api.ashbyhq.com/posting-api/job-board/';

/** The salary component of the compensation summary, when the board shows one. */
function salaryFor(entry: Raw) {
  for (const part of asArray(asRecord(entry.compensation)?.summaryComponents)) {
    const record = asRecord(part);
    if (record && str(record.compensationType) === 'Salary') {
      return salaryOf(num(record.minValue), num(record.maxValue), str(record.currencyCode), periodOf(record.interval));
    }
  }
  return null;
}

function toJob(entry: Raw, company: string): NormalizedJob | null {
  const title = str(entry.title);
  const url = str(entry.jobUrl);
  const id = str(entry.id);
  // Unlisted postings are reachable by link only; the board doesn't want them shown.
  if (!title || !url || !id || !company || entry.isListed === false) return null;
  const location = str(entry.location) || null;
  const plain = str(entry.descriptionPlain);
  return {
    source: 'ashby',
    sourceRef: id,
    title,
    company,
    location,
    remote: entry.isRemote === true || str(entry.workplaceType) === 'Remote' || looksRemote(location),
    url,
    applyUrl: str(entry.applyUrl) || null,
    applyEmail: null,
    description: plain ? toDescription(plain, false) : toDescription(str(entry.descriptionHtml)),
    thin: false,
    salary: salaryFor(entry),
    postedAt: toIso(entry.publishedAt),
    attribution: null,
  };
}

export function parseAshby(raw: unknown, company: string): NormalizedJob[] {
  return asArray(asRecord(raw)?.jobs).flatMap((entry) => {
    const item = asRecord(entry);
    const job = item ? toJob(item, company) : null;
    return job ? [job] : [];
  });
}

function boardUrl(name: string) {
  return `${API}${encodeURIComponent(name)}?includeCompensation=true`;
}

export async function fetchAshby(query: SourceQuery): Promise<NormalizedJob[]> {
  return eachWatched(query.watchlist, 'ashby', async (company) => parseAshby(await getJson(boardUrl(company.slug), { timeoutMs: 20_000 }), company.name));
}

/** One posting, for a pasted jobs.ashbyhq.com link. Ashby has no public single-job call, so the board is read and searched. */
export async function fetchAshbyJob(board: string, id: string): Promise<NormalizedJob | null> {
  const jobs = parseAshby(await getJson(boardUrl(board), { timeoutMs: 20_000 }), titleFromSlug(board));
  return jobs.find((job) => job.sourceRef === id) ?? null;
}
