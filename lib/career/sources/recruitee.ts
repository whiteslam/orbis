/**
 * Career source: Recruitee careers sites (company watchlist and pasted
 * links), via the public Careers Site API. Each job keeps the company
 * subdomain and offer slug so Send can post the application to Recruitee.
 */
import type { NormalizedJob } from '../types.ts';
import { asArray, asRecord, eachWatched, looksRemote, num, periodOf, salaryOf, str, titleFromSlug, toDescription, toIso, type Raw } from './common.ts';
import { getJson } from './http.ts';
import type { SourceQuery } from './index.ts';

export function recruiteeApi(company: string) {
  return `https://${encodeURIComponent(company)}.recruitee.com/api/offers/`;
}

/** "2026-10-22 12:11:23 UTC" as ISO. */
function stamp(value: unknown) {
  const text = str(value);
  return toIso(text.endsWith(' UTC') ? `${text.slice(0, -4).replace(' ', 'T')}Z` : text);
}

function salaryFor(entry: Raw) {
  const salary = asRecord(entry.salary);
  if (!salary) return null;
  return salaryOf(num(salary.min), num(salary.max), str(salary.currency), periodOf(salary.period));
}

function toJob(entry: Raw, company: string): NormalizedJob | null {
  const title = str(entry.title);
  const slug = str(entry.slug);
  const id = str(entry.id);
  const url = str(entry.careers_url) || `https://${company}.recruitee.com/o/${slug}`;
  if (!title || !slug || !id || !company) return null;
  const location = str(entry.location) || [str(entry.city), str(entry.country)].filter(Boolean).join(', ') || null;
  return {
    source: 'recruitee',
    sourceRef: id,
    title,
    company: str(entry.company_name) || titleFromSlug(company),
    location,
    remote: entry.remote === true || looksRemote(location),
    url,
    applyUrl: str(entry.careers_apply_url) || null,
    applyEmail: null,
    description: toDescription(`${str(entry.description)}\n${str(entry.requirements)}`),
    thin: false,
    salary: salaryFor(entry),
    postedAt: stamp(entry.published_at) ?? stamp(entry.created_at),
    attribution: null,
    recruitee: { company, offer: slug },
  };
}

/** The offers in a list reply ({ offers }) or a single offer reply ({ offer }). `company` is the subdomain. */
export function parseRecruitee(raw: unknown, company: string): NormalizedJob[] {
  const record = asRecord(raw);
  const entries = record && 'offer' in record ? [record.offer] : asArray(record?.offers);
  return entries.flatMap((entry) => {
    const item = asRecord(entry);
    const job = item ? toJob(item, company) : null;
    return job ? [job] : [];
  });
}

export async function fetchRecruitee(query: SourceQuery): Promise<NormalizedJob[]> {
  return eachWatched(query.watchlist, 'recruitee', async (company) => parseRecruitee(await getJson(recruiteeApi(company.slug), { timeoutMs: 20_000 }), company.slug));
}

/** One offer, for a pasted <company>.recruitee.com/o/<slug> link. */
export async function fetchRecruiteeJob(company: string, slug: string): Promise<NormalizedJob | null> {
  return parseRecruitee(await getJson(`${recruiteeApi(company)}${encodeURIComponent(slug)}`), company)[0] ?? null;
}
