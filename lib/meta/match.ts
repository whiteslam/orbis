import type { LivePost, MetaPlatform } from '@/lib/meta/types';

const PREFIX = 80;
const MIN_CAPTION = 12;
const WINDOW_DAYS = 3;

export type PlannedPost = { id: string; platforms: string[]; status: string; plannedFor: string | null; period: string; caption: string; publishedOn: MetaPlatform[] };

/** Lowercase, and without hashtags, emoji, links or runs of whitespace. */
export function normalizeCaption(value: string) {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/#[\p{L}\p{M}\p{N}_]+/gu, ' ')
    // Emoji and everything that modifies them: skin tones, flags, keycaps, joiners, variation selectors.
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|⃣|‍|️/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The India-time date of a Meta timestamp ('2026-09-21T04:30:00+0000'). */
function indiaDate(timestamp: string) {
  const iso = timestamp.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso));
}

function daysApart(a: string, b: string) {
  return Math.abs(Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000));
}

function fits(plan: PlannedPost, post: LivePost) {
  const want = normalizeCaption(plan.caption);
  if (want.length < MIN_CAPTION) return false;
  const day = indiaDate(post.timestamp);
  const inWindow = plan.plannedFor ? daysApart(day, plan.plannedFor) <= WINDOW_DAYS : day.slice(0, 7) === plan.period.slice(0, 7);
  if (!inWindow) return false;
  const got = normalizeCaption(post.caption);
  return want.length < PREFIX ? got === want || got.startsWith(want) : got.startsWith(want.slice(0, PREFIX));
}

/**
 * Pairs live posts with planned ones. Only one-to-one pairs count: a live
 * post that fits two planned posts, or a planned post that fits two live ones,
 * is left for the person to mark, because guessing wrong would be worse.
 */
export function matchPosts(platform: MetaPlatform, planned: PlannedPost[], live: LivePost[]) {
  const candidates = planned.filter((plan) => plan.platforms.includes(platform) && (plan.status === 'ready' || plan.status === 'published') && !plan.publishedOn.includes(platform));
  const pairs: Array<{ postId: string; live: LivePost }> = [];
  for (const plan of candidates) {
    const fitting = live.filter((post) => fits(plan, post));
    if (fitting.length !== 1) continue;
    const rivals = candidates.filter((other) => fits(other, fitting[0]));
    if (rivals.length !== 1) continue;
    pairs.push({ postId: plan.id, live: fitting[0] });
  }
  return pairs;
}
