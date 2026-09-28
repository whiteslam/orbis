// Month maths and the rules a post has to meet, shared by server and browser.
//
// Ported from WBT's lib/content-gen/monthly.ts. Dates are plain 'YYYY-MM-DD'
// strings and all arithmetic is done in UTC, so a date never slides a day
// because of where the code happens to run.
import type { SocialPlatform, SocialPost } from './types.ts';
// Relative, so the unit tests can load this module under plain Node.
import { CAPTION_LIMIT } from './types.ts';

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (value: number) => String(value).padStart(2, '0');
const iso = (date: Date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const parts = (period: string) => ({ year: Number(period.slice(0, 4)), month: Number(period.slice(5, 7)) });

export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-01$/;
export const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Today as 'YYYY-MM-DD' in India, where the month and "today" are counted. */
export function indiaToday(now = new Date()) {
  const pieces = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => pieces.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** '2026-09-01' */
export function periodOf(year: number, month: number) {
  return `${year}-${pad(month)}-01`;
}

/** 'September 2026' */
export function monthName(period: string) {
  const { year, month } = parts(period);
  return `${MONTHS[month - 1] ?? ''} ${year}`;
}

/** The period a date belongs to. */
export function periodOfDate(date: string) {
  return `${date.slice(0, 7)}-01`;
}

/** The month one step either side, wrapping the year. */
export function shiftMonth(period: string, by: -1 | 1) {
  const { year, month } = parts(period);
  const next = new Date(Date.UTC(year, month - 1 + by, 1));
  return periodOf(next.getUTCFullYear(), next.getUTCMonth() + 1);
}

export function daysInMonth(period: string) {
  const { year, month } = parts(period);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** True for a real calendar day, so '2026-02-30' is rejected. */
export function isRealDate(date: string) {
  if (!DATE_PATTERN.test(date)) return false;
  return Number(date.slice(8, 10)) <= daysInMonth(periodOfDate(date));
}

/**
 * Monday-start calendar: 5 or 6 weeks of 7 days. Days outside the month are
 * included with inMonth=false so the grid is always rectangular.
 */
export function monthGrid(period: string) {
  const { year, month } = parts(period);
  const first = new Date(Date.UTC(year, month - 1, 1));
  // getUTCDay: 0 = Sunday. Monday-start means Sunday is the 7th column.
  const lead = (first.getUTCDay() + 6) % 7;
  const total = Math.ceil((lead + daysInMonth(period)) / 7) * 7;
  const weeks: { date: string; inMonth: boolean }[][] = [];
  for (let index = 0; index < total; index += 1) {
    const day = new Date(Date.UTC(year, month - 1, 1 - lead + index));
    if (index % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push({ date: iso(day), inMonth: day.getUTCMonth() === month - 1 });
  }
  return weeks;
}

/** Posts per day for the grid, plus the undated tray. Order within a day is kept. */
export function placePosts(posts: SocialPost[]) {
  const byDay = new Map<string, SocialPost[]>();
  const undated: SocialPost[] = [];
  for (const post of posts) {
    if (!post.plannedFor) {
      undated.push(post);
      continue;
    }
    const day = byDay.get(post.plannedFor) ?? [];
    day.push(post);
    byDay.set(post.plannedFor, day);
  }
  return { byDay, undated };
}

/**
 * Why a post cannot be marked ready, in plain words, or null.
 * Ported from WBT's pushProblem(), applied per post instead of per month.
 */
export function readyProblem(post: Pick<SocialPost, 'title' | 'caption' | 'format' | 'plannedFor' | 'period' | 'mediaPath'>): string | null {
  if (!post.title.trim()) return 'Give the post a title.';
  if (!post.caption.trim()) return 'Write a caption first.';
  if (!post.plannedFor) return 'Pick a day for this post.';
  if (!post.plannedFor.startsWith(post.period.slice(0, 8))) return 'Pick a day inside this month.';
  if (post.format === 'reel' && !post.mediaPath) return 'Add a picture or video — reels need one.';
  if (post.format === 'story' && !post.mediaPath) return 'Add a picture or video — stories need one.';
  return null;
}

/** The caption as it will be posted: text, a blank line, then the hashtags. */
export function postedLength(caption: string, hashtags: string[]) {
  const tags = hashtags.map((tag) => `#${tag}`).join(' ');
  return tags ? caption.length + 2 + tags.length : caption.length;
}

/** Platforms whose limit the caption (plus hashtags) goes over. */
export function overLimit(caption: string, hashtags: string[], platforms: SocialPlatform[]): SocialPlatform[] {
  const length = postedLength(caption, hashtags);
  return platforms.filter((platform) => length > CAPTION_LIMIT[platform]);
}

/** The line under the month: '12 posts · 7 ready · 3 published' or 'Nothing planned yet'. */
export function monthSummary(posts: SocialPost[]) {
  if (!posts.length) return 'Nothing planned yet';
  const ready = posts.filter((post) => post.status === 'ready').length;
  const published = posts.filter((post) => post.status === 'published').length;
  return [
    `${posts.length} ${posts.length === 1 ? 'post' : 'posts'}`,
    ready ? `${ready} ready` : '',
    published ? `${published} published` : '',
  ].filter(Boolean).join(' · ');
}

/** Does this edit knock a ready post back to draft? True when caption, title, media or format changed. */
export function editUnreadies(before: SocialPost, after: Partial<SocialPost>) {
  return (after.caption !== undefined && after.caption !== before.caption)
    || (after.title !== undefined && after.title !== before.title)
    || (after.mediaPath !== undefined && after.mediaPath !== before.mediaPath)
    || (after.format !== undefined && after.format !== before.format);
}
