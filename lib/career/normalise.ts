/**
 * Career: the normal forms dedupe and matching compare on, plus the small
 * readers every AI-reply parser in lib/career shares. Client-safe and pure.
 */
import { titleWords } from './skills.ts';

// ─── Company ────────────────────────────────────────────────────────────

// Legal and filler suffixes, dropped from the end only so "Tech Mahindra" keeps "tech".
const COMPANY_SUFFIXES = new Set([
  'inc', 'incorporated', 'ltd', 'limited', 'llc', 'llp', 'plc', 'pvt', 'private', 'corp', 'corporation', 'co', 'company',
  'gmbh', 'ag', 'sa', 'sas', 'bv', 'nv', 'oy', 'ab', 'pte', 'pty', 'srl', 'kk', 'technologies', 'technology', 'tech',
  'labs', 'lab', 'software', 'solutions', 'systems', 'group', 'holdings', 'hq', 'io', 'ai',
]);

function asciiFold(text: string) {
  return text.normalize('NFKD').replaceAll(/[̀-ͯ]/g, '');
}

/** Words of a company name: lowercase, dots and apostrophes vanish ("Inc." → "inc"), other punctuation splits. */
function companyWords(name: string) {
  const words: string[] = [];
  let current = '';
  for (const char of asciiFold(name.toLowerCase())) {
    if (char === '.' || char === "'" || char === '’') continue;
    if ((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char > '\u007f') {
      current += char;
    } else {
      if (current) words.push(current);
      current = '';
    }
  }
  if (current) words.push(current);
  return words;
}

/** "Acme Technologies Pvt. Ltd." → "acme". Never empty when the name has a word. */
export function normaliseCompany(name: string): string {
  const words = companyWords(name);
  if (words[0] === 'the' && words.length > 1) words.shift();
  let end = words.length;
  while (end > 1 && COMPANY_SUFFIXES.has(words[end - 1])) end -= 1;
  return words.slice(0, end).join(' ');
}

// ─── Title ──────────────────────────────────────────────────────────────

const TITLE_ALIASES = new Map([
  ['sr', 'senior'], ['snr', 'senior'], ['jr', 'junior'], ['dev', 'developer'], ['eng', 'engineer'], ['engr', 'engineer'],
  ['mgr', 'manager'], ['swe', 'software engineer'], ['sde', 'software engineer'],
]);

// Where-and-how words a board adds to a title; the job is the same without them.
const TITLE_NOISE = new Set(['remote', 'hybrid', 'onsite', 'wfh', 'urgent', 'hiring', 'immediate', 'joiner', 'm', 'f', 'd', 'x', 'w']);

/** "Sr. Front-End Dev (Remote)" → "senior frontend developer". Seniority is kept: senior and junior are different jobs. */
export function normaliseTitle(title: string): string {
  const out: string[] = [];
  for (const word of titleWords(title)) {
    if (TITLE_NOISE.has(word)) continue;
    out.push(TITLE_ALIASES.get(word) ?? word);
  }
  return out.join(' ');
}

// ─── Location ───────────────────────────────────────────────────────────

const REMOTE_WORDS = new Set(['remote', 'anywhere', 'worldwide', 'wfh']);

const CITY_ALIASES = new Map([
  ['bangalore', 'bengaluru'], ['bombay', 'mumbai'], ['gurgaon', 'gurugram'], ['new delhi', 'delhi'], ['madras', 'chennai'],
  ['calcutta', 'kolkata'], ['poona', 'pune'], ['nyc', 'new york'], ['new york city', 'new york'], ['sf', 'san francisco'],
  ['san francisco bay area', 'san francisco'], ['bay area', 'san francisco'], ['greater london', 'london'],
]);

/** Plain words of a place: lowercase, ASCII, punctuation as spaces. */
export function placeWords(text: string): string[] {
  return companyWords(text);
}

/**
 * The place a job is in, coarse enough that two boards agree: 'remote', the
 * first named place (usually the city, with common aliases resolved), or 'unknown'.
 */
export function locationBucket(location: string | null, remote: boolean): string {
  if (remote) return 'remote';
  if (!location?.trim()) return 'unknown';
  if (placeWords(location).some((word) => REMOTE_WORDS.has(word))) return 'remote';
  for (const part of location.split(/[,|/;]/)) {
    const words = placeWords(part);
    if (!words.length) continue;
    const place = words.join(' ');
    return CITY_ALIASES.get(place) ?? place;
  }
  return 'unknown';
}

// ─── Reading AI replies ─────────────────────────────────────────────────

/**
 * The JSON object in a model's reply, or null. Tolerates a Markdown fence and
 * a sentence around the object; the router already unfences, but a reply
 * re-parsed later may not have gone through it.
 */
export function readJsonObject(reply: string): Record<string, unknown> | null {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(reply.slice(start, end + 1));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A trimmed, single-spaced string capped at `max`, or '' for anything else. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.split(/\s+/).filter(Boolean).join(' ').slice(0, max).trim();
}

/** cleanText, but null instead of ''. */
export function cleanNullable(value: unknown, max: number): string | null {
  return cleanText(value, max) || null;
}

/** Unique non-empty cleaned strings, at most `maxItems`. */
export function cleanList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = cleanText(item, maxLength);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** A finite number within [min, max] (rounded when `integer`), else null. */
export function cleanNumber(value: unknown, min: number, max: number, integer = false): number | null {
  const number = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max) return null;
  return integer ? Math.round(number) : number;
}
