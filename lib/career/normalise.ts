/**
 * Career: the normal forms dedupe and matching compare on. Client-safe and
 * pure. The readers for AI replies live in lib/ai/json.ts.
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
