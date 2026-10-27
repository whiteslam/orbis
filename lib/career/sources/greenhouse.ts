/**
 * Career source: Greenhouse job boards (company watchlist and pasted links),
 * via the public Job Board API. `content` arrives as HTML-escaped HTML.
 */
import type { NormalizedJob } from '../types.ts';
import { decodeEntities } from '../text.ts';
import { asArray, asRecord, eachWatched, looksRemote, str, titleFromSlug, toDescription, toIso, type Raw } from './common.ts';
import { getJson } from './http.ts';
import type { SourceQuery } from './index.ts';

const API = 'https://boards-api.greenhouse.io/v1/boards/';

function toJob(entry: Raw, company: string): NormalizedJob | null {
  const title = str(entry.title);
  const url = str(entry.absolute_url);
  const id = str(entry.id);
  const name = str(entry.company_name) || company;
  if (!title || !url || !id || !name) return null;
  const location = str(asRecord(entry.location)?.name) || null;
  return {
    source: 'greenhouse',
    sourceRef: id,
    title,
    company: name,
    location,
    remote: looksRemote(location, title),
    url,
    applyUrl: null,
    applyEmail: null,
    // Escaped once more than normal HTML: "&lt;p&gt;".
    description: toDescription(decodeEntities(str(entry.content))),
    thin: false,
    salary: null,
    postedAt: toIso(str(entry.first_published) || str(entry.updated_at)),
    attribution: null,
  };
}

/** The jobs in a board reply ({ jobs }) or a single job reply. */
export function parseGreenhouse(raw: unknown, company = ''): NormalizedJob[] {
  const record = asRecord(raw);
  const entries = record && 'jobs' in record ? asArray(record.jobs) : [raw];
  return entries.flatMap((entry) => {
    const item = asRecord(entry);
    const job = item ? toJob(item, company) : null;
    return job ? [job] : [];
  });
}

export async function fetchGreenhouse(query: SourceQuery): Promise<NormalizedJob[]> {
  return eachWatched(query.watchlist, 'greenhouse', async (company) => {
    const raw = await getJson(`${API}${encodeURIComponent(company.slug)}/jobs?content=true`, { timeoutMs: 20_000 });
    return parseGreenhouse(raw, company.name);
  });
}

/** One job, for a pasted job-boards.greenhouse.io link. */
export async function fetchGreenhouseJob(token: string, id: string): Promise<NormalizedJob | null> {
  const raw = await getJson(`${API}${encodeURIComponent(token)}/jobs/${encodeURIComponent(id)}?content=true`);
  return parseGreenhouse(raw, titleFromSlug(token))[0] ?? null;
}
