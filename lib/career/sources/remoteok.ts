/**
 * Career source: Remote OK, via its public API. Its terms ask for a followed
 * link back and "Remote OK" named as the source; never its logo.
 */
import type { NormalizedJob } from '../types.ts';
import { repairMojibake } from '../text.ts';
import { asArray, asRecord, num, salaryOf, str, toDescription, toIso, type Raw } from './common.ts';
import { getJson } from './http.ts';

export const REMOTEOK_ATTRIBUTION = 'via Remote OK';
const API = 'https://remoteok.com/api';

function toJob(entry: Raw): NormalizedJob | null {
  const title = repairMojibake(str(entry.position));
  const company = repairMojibake(str(entry.company));
  const url = str(entry.url);
  const id = str(entry.id);
  if (!title || !company || !url || !id) return null;
  const applyUrl = str(entry.apply_url);
  return {
    source: 'remoteok',
    sourceRef: id,
    title,
    company,
    location: repairMojibake(str(entry.location)) || 'Anywhere',
    remote: true,
    url,
    applyUrl: applyUrl && applyUrl !== url ? applyUrl : null,
    applyEmail: null,
    // Remote OK double-encodes its UTF-8 ("Weâ\u0080\u0099re").
    description: toDescription(repairMojibake(str(entry.description))),
    thin: false,
    salary: salaryOf(num(entry.salary_min), num(entry.salary_max), 'USD', 'year'),
    postedAt: toIso(str(entry.date) || entry.epoch),
    attribution: REMOTEOK_ATTRIBUTION,
  };
}

/** The jobs in the API's array; its first element is a legal notice, not a job. */
export function parseRemoteOk(raw: unknown): NormalizedJob[] {
  return asArray(raw).flatMap((entry) => {
    const record = asRecord(entry);
    const job = record && !('legal' in record) ? toJob(record) : null;
    return job ? [job] : [];
  });
}

export async function fetchRemoteOk(): Promise<NormalizedJob[]> {
  return parseRemoteOk(await getJson(API, { timeoutMs: 20_000 }));
}
