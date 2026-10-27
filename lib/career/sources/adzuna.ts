/**
 * Career source: Adzuna's job search API. Needs ADZUNA_APP_ID and
 * ADZUNA_APP_KEY and stands down without them. Credit "Jobs by Adzuna".
 */
import type { NormalizedJob } from '../types.ts';
import { htmlToText } from '../text.ts';
import { asArray, asRecord, looksRemote, num, salaryOf, str, toDescription, toIso, type Raw } from './common.ts';
import { getJson } from './http.ts';
import type { SourceQuery } from './index.ts';

export const ADZUNA_ATTRIBUTION = 'Jobs by Adzuna';
/** Calls per run stay at roles × countries, each capped at three. */
const MAX_ROLES = 3;
const MAX_COUNTRIES = 3;

/** Adzuna quotes salaries in the country's currency. */
const CURRENCY: Record<string, string> = {
  in: 'INR', gb: 'GBP', us: 'USD', ca: 'CAD', au: 'AUD', nz: 'NZD', sg: 'SGD', za: 'ZAR', de: 'EUR', fr: 'EUR',
  nl: 'EUR', it: 'EUR', es: 'EUR', at: 'EUR', be: 'EUR', pl: 'PLN', ch: 'CHF', br: 'BRL', mx: 'MXN',
};

function salaryFor(entry: Raw, country: string) {
  // A predicted salary is Adzuna's estimate, not the employer's figure.
  if (str(entry.salary_is_predicted) === '1') return null;
  return salaryOf(num(entry.salary_min), num(entry.salary_max), CURRENCY[country] ?? '', 'year');
}

function toJob(entry: Raw, country: string): NormalizedJob | null {
  // Titles carry search highlighting ("<strong>React</strong> Developer").
  const title = htmlToText(str(entry.title));
  const company = str(asRecord(entry.company)?.display_name);
  const url = str(entry.redirect_url);
  const id = str(entry.id);
  if (!title || !company || !url || !id) return null;
  const location = str(asRecord(entry.location)?.display_name) || null;
  const description = toDescription(str(entry.description));
  return {
    source: 'adzuna',
    sourceRef: id,
    title,
    company,
    location,
    remote: looksRemote(title, location, description),
    url,
    applyUrl: null,
    applyEmail: null,
    description,
    // Adzuna gives a snippet of about 500 characters, not the full listing.
    thin: true,
    salary: salaryFor(entry, country),
    postedAt: toIso(entry.created),
    attribution: ADZUNA_ATTRIBUTION,
  };
}

export function parseAdzuna(raw: unknown, country: string): NormalizedJob[] {
  return asArray(asRecord(raw)?.results).flatMap((entry) => {
    const record = asRecord(entry);
    const job = record ? toJob(record, country.toLowerCase()) : null;
    return job ? [job] : [];
  });
}

export function adzunaUrl(country: string, role: string, appId: string, appKey: string) {
  const params = new URLSearchParams({ app_id: appId, app_key: appKey, what: role, results_per_page: '50', 'content-type': 'application/json' });
  return `https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(country.toLowerCase())}/search/1?${params}`;
}

export async function fetchAdzuna(query: SourceQuery): Promise<NormalizedJob[]> {
  const appId = query.env.ADZUNA_APP_ID;
  const appKey = query.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) return [];
  const countries = query.countries.length ? query.countries : ['in'];
  const jobs: NormalizedJob[] = [];
  for (const country of countries.slice(0, MAX_COUNTRIES)) {
    for (const role of query.roles.slice(0, MAX_ROLES)) {
      jobs.push(...parseAdzuna(await getJson(adzunaUrl(country, role, appId, appKey)), country));
    }
  }
  return jobs;
}
