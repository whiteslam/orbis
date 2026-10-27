// The Career row under the Home brief: the one job-hunt fact worth a glance.
//
// The most pressing of: an interview within 24 hours, an offer waiting, drafts
// waiting for the owner's approval, new matches. State, not a call to action,
// like every other quiet row; it opens the Career tab. No row at all until
// Career is set up, so Home stays quiet for anyone not job hunting.
import type { QuietRow } from '@/lib/focus/types';

export type CareerToday = {
  /** Applications at the interview stage, with the time when the invite gave one (ISO with offset). */
  interviews: Array<{ company: string; at: string | null }>;
  /** Applications holding an offer. */
  offers: Array<{ company: string }>;
  /** Drafts waiting for the owner's Send. */
  queue: number;
  /** New, unexcluded jobs at or above the owner's bar. */
  newMatches: number;
};

const DAY_MS = 86_400_000;
// Home reads in India's clock, like the rest of Today.
const IST_OFFSET_MS = 330 * 60_000;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "today, 15:30" or "tomorrow, 10:00" in India's time; locale-free so it reads the same everywhere. */
function whenLabel(at: number, now: Date): string {
  const local = new Date(at + IST_OFFSET_MS);
  const today = new Date(now.getTime() + IST_OFFSET_MS);
  const sameDay = local.toISOString().slice(0, 10) === today.toISOString().slice(0, 10);
  const time = local.toISOString().slice(11, 16);
  return `${sameDay ? 'today' : 'tomorrow'}, ${time}`;
}

/** The soonest interview starting within the next 24 hours, if any. */
function nextInterview(interviews: CareerToday['interviews'], now: Date) {
  let best: { company: string; at: number } | null = null;
  for (const interview of interviews) {
    const at = interview.at ? Date.parse(interview.at) : Number.NaN;
    if (Number.isNaN(at) || at < now.getTime() || at - now.getTime() > DAY_MS) continue;
    if (!best || at < best.at) best = { company: interview.company, at };
  }
  return best;
}

function careerValue(input: CareerToday, now: Date): string | null {
  const interview = nextInterview(input.interviews, now);
  if (interview) return `Interview with ${interview.company} ${whenLabel(interview.at, now)}`;
  if (input.offers.length === 1) return `Offer from ${input.offers[0].company} waiting`;
  if (input.offers.length > 1) return `${input.offers.length} offers waiting`;
  if (input.queue > 0) return `${plural(input.queue, 'draft', 'drafts')} waiting for your approval`;
  if (input.newMatches > 0) return plural(input.newMatches, 'new match', 'new matches');
  return null;
}

export function composeCareerRow(input: CareerToday | null, now: Date): QuietRow | null {
  if (!input) return null;
  const value = careerValue(input, now);
  return value
    ? { label: 'Career', value, empty: false, target: 'career' }
    : { label: 'Career', value: 'Nothing new', empty: true, target: 'career' };
}
