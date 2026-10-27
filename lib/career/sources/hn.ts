/**
 * Career source: Hacker News "Ask HN: Who is hiring?", via Algolia's free API
 * (no key). The newest monthly thread by `whoishiring`, then its top-level
 * comments, each one company's post. Credit "via Hacker News".
 */
import type { NormalizedJob } from '../types.ts';
import { collapseWhitespace, decodeEntities, htmlToText } from '../text.ts';
import { asArray, asRecord, looksRemote, str, toDescription, toIso, type Raw } from './common.ts';
import { getJson } from './http.ts';
import { parseSalaryText } from './salary.ts';

export const HN_ATTRIBUTION = 'via Hacker News';
const SEARCH = 'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring';
const ITEM = 'https://hn.algolia.com/api/v1/items/';
const THREAD_TITLE = 'ask hn: who is hiring?';
/** Older posts are usually filled; the monthly thread stays up for weeks. */
const MAX_AGE_DAYS = 40;
const DAY_MS = 86_400_000;

// ─── Emails ──────────────────────────────────────────────────────────────

const LOCAL_CHARS = /[a-z0-9._%+-]/i;
const DOMAIN_CHARS = /[a-z0-9.-]/i;

/** "jobs [at] acme [dot] com" and "jobs(at)acme.com" as plain addresses. */
function unbracket(text: string) {
  return text
    .replaceAll(/[[({<] ?at ?[\])}>]/gi, '@')
    .replaceAll(/[[({<] ?dot ?[\])}>]/gi, '.')
    .replaceAll(' @ ', '@')
    .replaceAll(' . ', '.');
}

/** A domain that ends in a real-looking top-level part. */
function plausibleDomain(domain: string) {
  const dot = domain.lastIndexOf('.');
  return dot > 0 && !domain.startsWith('.') && /^[a-z]{2,}$/i.test(domain.slice(dot + 1)) && [...domain].every((char) => DOMAIN_CHARS.test(char));
}

/** "name at domain dot com" (spelled out) as "name@domain.com". */
function spelledOut(text: string) {
  const words = text.replaceAll(' dot ', '.').replaceAll(' DOT ', '.').split(' ');
  const found: string[] = [];
  for (let i = 1; i < words.length - 1; i += 1) {
    if (words[i].toLowerCase() !== 'at') continue;
    const local = words[i - 1].replace(/^[("'<]+/, '');
    let domain = words[i + 1];
    while (domain && !/[a-z0-9]/i.test(domain.at(-1) ?? '')) domain = domain.slice(0, -1);
    if (local && [...local].every((char) => LOCAL_CHARS.test(char)) && plausibleDomain(domain)) found.push(`${local}@${domain}`);
  }
  return found;
}

/** Addresses written with an '@', found by scanning out from each one. */
function plainAddresses(text: string) {
  const found: string[] = [];
  let at = text.indexOf('@');
  while (at !== -1) {
    let start = at;
    while (start > 0 && LOCAL_CHARS.test(text[start - 1])) start -= 1;
    let end = at + 1;
    while (end < text.length && DOMAIN_CHARS.test(text[end])) end += 1;
    let local = text.slice(start, at);
    while (local.startsWith('.')) local = local.slice(1);
    let domain = text.slice(at + 1, end);
    while (domain.endsWith('.') || domain.endsWith('-')) domain = domain.slice(0, -1);
    if (local && plausibleDomain(domain)) found.push(`${local}@${domain}`);
    at = text.indexOf('@', end);
  }
  return found;
}

/** Every email address in the text, de-obfuscated, lowercased, first seen first. */
export function findEmails(text: string): string[] {
  const flat = unbracket(collapseWhitespace(text));
  const all = [...plainAddresses(flat), ...spelledOut(flat)].map((email) => email.toLowerCase());
  return [...new Set(all)];
}

// ─── The first line ──────────────────────────────────────────────────────

type PartKind = 'url' | 'salary' | 'type' | 'mode' | 'role' | 'other';

const ROLE_WORDS = /\b(engineers?|engineering|developers?|swe|sre|devops|scientists?|designers?|managers?|leads?|architects?|analysts?|product|head of|director|founding|cto|vp|interns?|writers?|researchers?|roles?|recruiters?|programmers?|consultants?|specialists?|administrators?|marketing|sales|account executive|operations|positions?)\b/i;
const TYPE_WORDS = /\b(full[- ]?time|part[- ]?time|contract|contractor|internship|freelance|permanent)\b/i;
const MODE_WORDS = /\b(remote|onsite|on-site|hybrid|in[- ]office|in[- ]person)\b/i;

function kindOf(part: string): PartKind {
  const lower = part.toLowerCase();
  if (lower.includes('://') || (!lower.includes(' ') && lower.includes('.') && !lower.includes(','))) return 'url';
  if (parseSalaryText(part) || lower.includes('equity')) return 'salary';
  if (ROLE_WORDS.test(part)) return 'role';
  if (MODE_WORDS.test(part)) return 'mode';
  if (TYPE_WORDS.test(part) && part.length < 40) return 'type';
  return 'other';
}

/** The header cut into its fields: on '|', or on a dash when the post doesn't use pipes. */
function headerParts(header: string) {
  const pipes = header.split('|').map((part) => part.trim()).filter(Boolean);
  if (pipes.length > 1) return pipes;
  for (const dash of [' — ', ' – ', ' - ']) {
    const parts = header.split(dash).map((part) => part.trim()).filter(Boolean);
    if (parts.length > 1) return parts;
  }
  return pipes;
}

/** "PrairieLearn (Remote US) https://…" → the name, and the bracket when it is a place. */
function companyOf(first: string) {
  const words = first.split(' ').filter((word) => !word.includes('://'));
  let name = words.join(' ').trim();
  let place: string | null = null;
  const open = name.indexOf('(');
  const close = name.indexOf(')', open);
  if (open > 0 && close > open) {
    const inside = name.slice(open + 1, close).trim();
    if (MODE_WORDS.test(inside)) place = inside;
    name = `${name.slice(0, open)}${name.slice(close + 1)}`.trim();
  }
  return { name, place };
}

export type HnHeader = { company: string; role: string | null; location: string | null; remote: boolean; salaryText: string | null };

/** Reads "Company | Role | Place | REMOTE | $X" (in any order after the company). */
export function parseHnHeader(header: string): HnHeader {
  const [first = '', ...rest] = headerParts(header);
  const company = companyOf(first);
  const byKind = new Map<PartKind, string[]>();
  for (const part of rest) {
    const kind = kindOf(part);
    byKind.set(kind, [...(byKind.get(kind) ?? []), part]);
  }
  const modes = byKind.get('mode') ?? [];
  // A place in brackets after the name ("Acme (Remote US)") is the clearest; then the first plain field.
  const location = company.place ?? byKind.get('other')?.[0] ?? modes[0] ?? null;
  return {
    company: company.name,
    role: byKind.get('role')?.[0] ?? null,
    location,
    remote: looksRemote(...modes, company.place, location),
    salaryText: byKind.get('salary')?.[0] ?? null,
  };
}

// ─── Comments ────────────────────────────────────────────────────────────

/** Links after "apply" that are someone's profile, not an application page. */
const NOT_APPLY = ['linkedin.com', 'github.com', 'twitter.com', 'x.com', 'news.ycombinator.com'];

function isApplyPage(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return !NOT_APPLY.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

/** The first link after the word "apply", when one is near and is an application page. */
function applyLink(html: string) {
  const lower = html.toLowerCase();
  const apply = lower.indexOf('apply');
  if (apply === -1) return null;
  const href = lower.indexOf('href="', apply);
  if (href === -1 || href - apply > 400) return null;
  const end = html.indexOf('"', href + 6);
  const url = end === -1 ? '' : decodeEntities(html.slice(href + 6, end));
  return url.startsWith('http') && isApplyPage(url) ? url : null;
}

const HN_ID = /^\d+$/;

function toJob(comment: Raw, cutoff: number): NormalizedJob | null {
  const html = str(comment.text);
  const id = str(comment.id);
  const createdMs = typeof comment.created_at_i === 'number' ? comment.created_at_i * 1000 : Date.parse(str(comment.created_at));
  if (!html || !HN_ID.test(id) || Number.isNaN(createdMs) || createdMs < cutoff) return null;
  const firstBreak = html.indexOf('<p>');
  const header = parseHnHeader(collapseWhitespace(htmlToText(firstBreak === -1 ? html : html.slice(0, firstBreak))));
  if (!header.company) return null;
  const text = htmlToText(html);
  return {
    source: 'hn',
    sourceRef: id,
    // A post that names no single role still lists jobs; the description says which.
    title: header.role ?? 'Multiple roles',
    company: header.company,
    location: header.location,
    remote: header.remote,
    url: `https://news.ycombinator.com/item?id=${id}`,
    applyUrl: applyLink(html),
    applyEmail: findEmails(text)[0] ?? null,
    description: toDescription(text, false),
    thin: false,
    salary: header.salaryText ? parseSalaryText(header.salaryText) : null,
    postedAt: toIso(str(comment.created_at) || createdMs),
    attribution: HN_ATTRIBUTION,
  };
}

/** The id of the newest "Who is hiring?" thread in an Algolia search reply. */
export function latestHiringThread(raw: unknown): string | null {
  for (const hit of asArray(asRecord(raw)?.hits)) {
    const record = asRecord(hit);
    if (!record || !str(record.title).toLowerCase().startsWith(THREAD_TITLE)) continue;
    // The id goes into the item URL as is, so it must be the number HN ids always are.
    const id = str(record.objectID);
    return HN_ID.test(id) ? id : null;
  }
  return null;
}

/** The jobs in a thread (an Algolia item), skipping posts older than 40 days. */
export function parseHn(raw: unknown, now: Date = new Date()): NormalizedJob[] {
  const cutoff = now.getTime() - MAX_AGE_DAYS * DAY_MS;
  return asArray(asRecord(raw)?.children).flatMap((child) => {
    const record = asRecord(child);
    const job = record ? toJob(record, cutoff) : null;
    return job ? [job] : [];
  });
}

export async function fetchHn(): Promise<NormalizedJob[]> {
  const thread = latestHiringThread(await getJson(SEARCH));
  if (!thread) return [];
  // The whole thread is a few hundred KB.
  return parseHn(await getJson(`${ITEM}${thread}`, { timeoutMs: 20_000 }));
}
