/**
 * Career source: Jobspresso (curated remote jobs), via its WordPress job
 * feed. Link back to Jobspresso.
 */
import type { NormalizedJob } from '../types.ts';
import { htmlToText } from '../text.ts';
import { str, toDescription, toIso } from './common.ts';
import { getText } from './http.ts';
import { rssField, rssItems } from './rss.ts';
import { parseSalaryText } from './salary.ts';

export const JOBSPRESSO_ATTRIBUTION = 'via Jobspresso';
const FEED = 'https://jobspresso.co/?feed=job_feed';

/** "Twilio<br>⚲&nbsp;United States" (dc:creator) → company and place, for items without the job_listing fields. */
function fromCreator(creator: string) {
  const [company = '', place = ''] = htmlToText(creator).split('\n');
  return { company: company.trim(), place: place.replace('⚲', '').trim() };
}

function toJob(item: string): NormalizedJob | null {
  const title = str(rssField(item, 'title'));
  const url = str(rssField(item, 'link'));
  const creator = fromCreator(rssField(item, 'dc:creator') ?? '');
  const company = str(rssField(item, 'job_listing:company')) || creator.company;
  if (!title || !company || !url) return null;
  const salaryText = str(rssField(item, 'job_listing:salary'));
  return {
    source: 'jobspresso',
    sourceRef: str(rssField(item, 'guid')) || url,
    title,
    company,
    location: str(rssField(item, 'job_listing:location')) || creator.place || 'Anywhere',
    // Jobspresso lists remote jobs only; the location says where from.
    remote: true,
    url,
    applyUrl: null,
    applyEmail: null,
    description: toDescription(rssField(item, 'content:encoded') ?? rssField(item, 'description') ?? ''),
    thin: false,
    salary: salaryText ? parseSalaryText(salaryText) : null,
    postedAt: toIso(rssField(item, 'pubDate')),
    attribution: JOBSPRESSO_ATTRIBUTION,
  };
}

export function parseJobspresso(xml: string): NormalizedJob[] {
  return rssItems(xml).flatMap((item) => {
    const job = toJob(item);
    return job ? [job] : [];
  });
}

export async function fetchJobspresso(): Promise<NormalizedJob[]> {
  const xml = await getText(FEED, { timeoutMs: 15_000 });
  return xml ? parseJobspresso(xml) : [];
}
