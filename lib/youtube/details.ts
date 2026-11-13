// What goes to YouTube with a video: the title, description, tags and settings, built from a
// finished short and cleaned again when the person edits them. Pure and client-safe. Type
// imports only, because the home-PC import script loads this file with plain Node.

import type { Delivery } from '../shorts/types';
import type { Preset, Privacy, VideoDetails } from './types';

export const TITLE_MAX = 100;
export const DESCRIPTION_MAX = 5000;
/** YouTube’s limit on the tags joined with commas, quotes counted. */
export const TAGS_MAX = 500;
/** Tags beyond this are of no use, and the column has no cap of its own. */
export const TAG_COUNT_MAX = 30;
export const MAX_ATTEMPTS = 3;

export const CATEGORIES: readonly { id: string; label: string }[] = [
  { id: '1', label: 'Film & Animation' },
  { id: '23', label: 'Comedy' },
  { id: '24', label: 'Entertainment' },
  { id: '27', label: 'Education' },
];

const CATEGORY_BY_STYLE: Record<string, string> = {
  'tall-tale': '23',
  'cozy-tales': '1',
  'deep-dive': '27',
  'inside-out': '27',
  'paper-atlas': '27',
  'night-file': '24',
  'stick-story': '24',
};

const PRIVACIES: readonly Privacy[] = ['public', 'unlisted', 'private'];

export function defaultPreset(style: string): Preset {
  return { style, privacy: 'public', categoryId: CATEGORY_BY_STYLE[style] ?? '24', madeForKids: false, tags: [] };
}

const ANGLES = /[<>]/g;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

const codePoints = (text: string) => [...text];
const cut = (text: string, max: number) => (codePoints(text).length > max ? codePoints(text).slice(0, max).join('') : text);

function cleanTitle(raw: string): string {
  return cut(raw.replace(ANGLES, '').replace(/\s+/g, ' ').trim(), TITLE_MAX).trim();
}

function cleanText(raw: string): string {
  return raw.replace(ANGLES, '').replace(CONTROL, '').replace(/\r\n?/g, '\n').trim();
}

/** The length YouTube counts for these tags: commas between them, quotes around any with a space. */
export function tagsLength(tags: string[]): number {
  let total = Math.max(0, tags.length - 1);
  for (const tag of tags) total += codePoints(tag).length + (/\s/.test(tag) ? 2 : 0);
  return total;
}

/** One tag, plain: no #, angle brackets, commas or control characters. Empty when nothing is left. */
function cleanTag(raw: string): string {
  return raw.replace(/^#+/, '').replace(ANGLES, '').replace(/,/g, '').replace(CONTROL, '').replace(/\s+/g, ' ').trim();
}

/** The tags in order, each once (case ignored), as many as fit the count and length limits. */
function fitTags(candidates: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of candidates) {
    const tag = cleanTag(raw);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key) || kept.length >= TAG_COUNT_MAX) continue;
    if (tagsLength([...kept, tag]) > TAGS_MAX) continue;
    seen.add(key);
    kept.push(tag);
  }
  return kept;
}

function hashtagLine(hashtags: readonly string[]): string {
  const tags = hashtags
    .map((tag) => `#${cleanTag(tag).replace(/\s+/g, '')}`)
    .filter((tag) => tag.length > 1);
  if (!tags.some((tag) => tag.toLowerCase() === '#shorts')) tags.push('#shorts');
  return tags.join(' ');
}

/** The details a finished short starts with, before the person edits them. */
export function buildDetails(delivery: Pick<Delivery, 'title' | 'caption' | 'hashtags'>, preset: Preset): VideoDetails {
  const line = hashtagLine(delivery.hashtags);
  const caption = cleanText(delivery.caption);
  const room = DESCRIPTION_MAX - codePoints(line).length - 2;
  const body = cut(caption, Math.max(0, room)).trim();
  return {
    title: cleanTitle(delivery.title),
    description: body ? `${body}\n\n${line}` : line,
    tags: fitTags([...delivery.hashtags, ...preset.tags]),
    categoryId: preset.categoryId,
    privacy: preset.privacy,
    madeForKids: preset.madeForKids,
  };
}

/** What the browser sent, checked and tidied, or null when it cannot be a video’s details. */
export function cleanDetails(input: unknown): VideoDetails | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const title = typeof raw.title === 'string' ? cleanTitle(raw.title) : '';
  if (!title) return null;
  if (typeof raw.categoryId !== 'string' || !/^\d{1,3}$/.test(raw.categoryId.trim())) return null;
  const privacy = PRIVACIES.find((one) => one === raw.privacy);
  if (!privacy) return null;
  const tags = Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : [];
  return {
    title,
    description: cut(typeof raw.description === 'string' ? cleanText(raw.description) : '', DESCRIPTION_MAX).trim(),
    tags: fitTags(tags),
    categoryId: raw.categoryId.trim(),
    privacy,
    madeForKids: raw.madeForKids === true,
  };
}
