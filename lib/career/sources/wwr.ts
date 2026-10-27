/**
 * Career source: We Work Remotely, via its RSS feeds (the all-jobs feed plus
 * the category feeds that fit the owner's roles). Link back to WWR.
 */
import type { NormalizedJob } from '../types.ts';
import { str, toDescription, toIso } from './common.ts';
import { getText } from './http.ts';
import type { SourceQuery } from './index.ts';
import { rssField, rssItems } from './rss.ts';

export const WWR_ATTRIBUTION = 'via We Work Remotely';
const BASE = 'https://weworkremotely.com';

/** Category feeds (all checked on 2026-10-27) and the role words that pick them. */
const CATEGORIES: Array<{ slug: string; words: string[] }> = [
  { slug: 'remote-front-end-programming-jobs', words: ['front', 'react', 'vue', 'angular', 'ui engineer', 'web developer', 'javascript', 'typescript'] },
  { slug: 'remote-back-end-programming-jobs', words: ['back', 'api', 'python', 'java', 'golang', 'node', 'ruby', 'php', 'rust'] },
  { slug: 'remote-full-stack-programming-jobs', words: ['full stack', 'full-stack', 'fullstack', 'software engineer', 'software developer'] },
  { slug: 'remote-devops-sysadmin-jobs', words: ['devops', 'sre', 'reliability', 'platform', 'infrastructure', 'cloud', 'sysadmin'] },
  { slug: 'remote-design-jobs', words: ['design', 'ux', 'ui/ux'] },
  { slug: 'remote-product-jobs', words: ['product'] },
  { slug: 'remote-customer-support-jobs', words: ['support', 'customer success'] },
  { slug: 'remote-sales-and-marketing-jobs', words: ['sales', 'marketing', 'growth', 'seo', 'content'] },
  { slug: 'remote-management-and-finance-jobs', words: ['manager', 'finance', 'accountant', 'operations', 'director'] },
];

/** The feeds worth reading for these roles: always the all-jobs feed, then up to three categories. */
export function wwrFeeds(roles: string[]): string[] {
  const text = roles.join(' | ').toLowerCase();
  const picked = CATEGORIES.filter((category) => category.words.some((word) => text.includes(word))).slice(0, 3);
  return [`${BASE}/remote-jobs.rss`, ...picked.map((category) => `${BASE}/categories/${category.slug}.rss`)];
}

/** "PlanetScale: Video Editor" → company and title. */
function splitTitle(full: string) {
  const colon = full.indexOf(': ');
  if (colon === -1) return { company: '', title: full };
  return { company: full.slice(0, colon).trim(), title: full.slice(colon + 2).trim() };
}

function toJob(item: string): NormalizedJob | null {
  const { company, title } = splitTitle(rssField(item, 'title') ?? '');
  const url = str(rssField(item, 'link')) || str(rssField(item, 'guid'));
  if (!title || !company || !url) return null;
  const place = [rssField(item, 'region'), rssField(item, 'country'), rssField(item, 'state')].map(str).filter(Boolean);
  return {
    source: 'wwr',
    sourceRef: str(rssField(item, 'guid')) || url,
    title,
    company,
    location: place.length ? place.join(', ') : 'Anywhere',
    remote: true,
    url,
    applyUrl: null,
    applyEmail: null,
    description: toDescription(rssField(item, 'description') ?? ''),
    thin: false,
    salary: null,
    postedAt: toIso(rssField(item, 'pubDate')),
    attribution: WWR_ATTRIBUTION,
  };
}

export function parseWwr(xml: string): NormalizedJob[] {
  return rssItems(xml).flatMap((item) => {
    const job = toJob(item);
    return job ? [job] : [];
  });
}

export async function fetchWwr(query: SourceQuery): Promise<NormalizedJob[]> {
  const seen = new Set<string>();
  const jobs: NormalizedJob[] = [];
  for (const feed of wwrFeeds(query.roles)) {
    const xml = await getText(feed, { timeoutMs: 15_000 });
    for (const job of xml ? parseWwr(xml) : []) {
      if (seen.has(job.sourceRef)) continue;
      seen.add(job.sourceRef);
      jobs.push(job);
    }
  }
  return jobs;
}
