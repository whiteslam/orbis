/**
 * Career source: Lever job sites (company watchlist and pasted links), via
 * the public Postings API. Lever doesn't send the company name, so it comes
 * from the watchlist (or the site slug).
 */
import type { NormalizedJob } from '../types.ts';
import { asArray, asRecord, eachWatched, looksRemote, num, periodOf, salaryOf, str, titleFromSlug, toDescription, toIso, type Raw } from './common.ts';
import { getJson } from './http.ts';
import type { SourceQuery } from './index.ts';

/** Lever hosts EU customers separately. */
export function leverApi(eu: boolean) {
  return eu ? 'https://api.eu.lever.co/v0/postings/' : 'https://api.lever.co/v0/postings/';
}

/** The description, its lists ("Requirements", "What you'll do") and the closing note, as one HTML body. */
function bodyHtml(entry: Raw) {
  const lists = asArray(entry.lists).map((list) => {
    const record = asRecord(list);
    return record ? `<h3>${str(record.text)}</h3><ul>${str(record.content)}</ul>` : '';
  });
  return [str(entry.description), ...lists, str(entry.additional)].join('\n');
}

function toJob(entry: Raw, company: string): NormalizedJob | null {
  const title = str(entry.text);
  const url = str(entry.hostedUrl);
  const id = str(entry.id);
  if (!title || !url || !id || !company) return null;
  const categories = asRecord(entry.categories);
  const places = asArray(categories?.allLocations).map(str).filter(Boolean);
  const location = str(categories?.location) || places.join(' / ') || null;
  const range = asRecord(entry.salaryRange);
  return {
    source: 'lever',
    sourceRef: id,
    title,
    company,
    location,
    remote: str(entry.workplaceType) === 'remote' || looksRemote(location, title),
    url,
    applyUrl: str(entry.applyUrl) || null,
    applyEmail: null,
    description: toDescription(bodyHtml(entry)),
    thin: false,
    salary: range ? salaryOf(num(range.min), num(range.max), str(range.currency), periodOf(range.interval)) : null,
    postedAt: toIso(entry.createdAt),
    attribution: null,
  };
}

/** The postings in a site reply (an array) or a single posting reply. */
export function parseLever(raw: unknown, company: string): NormalizedJob[] {
  const entries = Array.isArray(raw) ? raw : [raw];
  return entries.flatMap((entry) => {
    const item = asRecord(entry);
    const job = item ? toJob(item, company) : null;
    return job ? [job] : [];
  });
}

export async function fetchLever(query: SourceQuery): Promise<NormalizedJob[]> {
  return eachWatched(query.watchlist, 'lever', async (company) => {
    const raw = await getJson(`${leverApi(false)}${encodeURIComponent(company.slug)}?mode=json`, { timeoutMs: 20_000 });
    return parseLever(raw, company.name);
  });
}

/** One posting, for a pasted jobs.lever.co (or jobs.eu.lever.co) link. */
export async function fetchLeverJob(site: string, id: string, eu = false): Promise<NormalizedJob | null> {
  const raw = await getJson(`${leverApi(eu)}${encodeURIComponent(site)}/${encodeURIComponent(id)}?mode=json`);
  return parseLever(raw, titleFromSlug(site))[0] ?? null;
}
