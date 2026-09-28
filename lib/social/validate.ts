// Everything the browser sends about a post, trimmed and capped before it is
// trusted. Shared by the Server Actions and the AI draft parser, so a caption
// from a model meets exactly the same limits as one typed by hand.
import type { SocialFormat, SocialPlatform } from './types.ts';
// Relative, so the unit tests can load this module under plain Node.
import { PUBLISH_PLACES, SOCIAL_CAPS, SOCIAL_FORMATS, SOCIAL_PLATFORMS } from './types.ts';
import { MONTHS, PERIOD_PATTERN, isRealDate } from './month.ts';

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

const FORMAT_IDS = SOCIAL_FORMATS.map((item) => item.id) as string[];
const PLATFORM_IDS = SOCIAL_PLATFORMS.map((item) => item.id) as string[];
const PLACE_IDS = PUBLISH_PLACES.map((item) => item.id) as string[];

export const isFormat = (value: unknown): value is SocialFormat => typeof value === 'string' && FORMAT_IDS.includes(value);

const text = (value: unknown, cap: number) => (typeof value === 'string' ? value.trim().slice(0, cap) : '');

/** Stored without '#' and without spaces, once each (case-insensitively), 30 at most. */
export function cleanHashtags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const tag = item.replace(/^#+/, '').replace(/[\s#]+/g, '').slice(0, SOCIAL_CAPS.hashtag);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
    if (tags.length === SOCIAL_CAPS.hashtags) break;
  }
  return tags;
}

export function cleanPlatforms(value: unknown): SocialPlatform[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is SocialPlatform => typeof item === 'string' && PLATFORM_IDS.includes(item))));
}

export type CleanPost = {
  period: string;
  title: string;
  headline: string | null;
  caption: string;
  hashtags: string[];
  format: SocialFormat;
  platforms: SocialPlatform[];
  plannedFor: string | null;
};

export const monthWord = (period: string) => MONTHS[Number(period.slice(5, 7)) - 1] ?? 'this month';

export function cleanPostInput(input: unknown): Result<CleanPost> {
  if (!input || typeof input !== 'object') return { ok: false, message: 'Enter the post details.' };
  const raw = input as Record<string, unknown>;
  if (typeof raw.period !== 'string' || !PERIOD_PATTERN.test(raw.period)) return { ok: false, message: 'That month is invalid.' };
  const period = raw.period;
  const title = text(raw.title, SOCIAL_CAPS.title);
  if (!title) return { ok: false, message: 'Give the post a title.' };
  if (!isFormat(raw.format)) return { ok: false, message: 'Choose post, reel or story.' };

  let plannedFor: string | null = null;
  if (raw.plannedFor !== null && raw.plannedFor !== undefined && raw.plannedFor !== '') {
    const date = raw.plannedFor;
    if (typeof date !== 'string' || !isRealDate(date) || !date.startsWith(period.slice(0, 8))) {
      return { ok: false, message: `Pick a day inside ${monthWord(period)}.` };
    }
    plannedFor = date;
  }

  return {
    ok: true,
    value: {
      period,
      title,
      headline: text(raw.headline, SOCIAL_CAPS.headline) || null,
      caption: text(raw.caption, SOCIAL_CAPS.caption),
      hashtags: cleanHashtags(raw.hashtags),
      format: raw.format,
      platforms: cleanPlatforms(raw.platforms),
      plannedFor,
    },
  };
}

/** Where and how a post went out. The link is optional, but a real https link when given. */
export function cleanPublish(input: unknown): Result<{ platform: string; link: string | null }> {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (typeof raw.platform !== 'string' || !PLACE_IDS.includes(raw.platform)) return { ok: false, message: 'Choose where it went out.' };
  const link = typeof raw.link === 'string' ? raw.link.trim() : '';
  if (!link) return { ok: true, value: { platform: raw.platform, link: null } };
  let valid = false;
  try {
    valid = link.length <= 500 && new URL(link).protocol === 'https:' && /^https:\/\//i.test(link);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, message: 'Paste the full link, starting with https://' };
  return { ok: true, value: { platform: raw.platform, link } };
}
