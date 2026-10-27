/**
 * Career: the words and numbers every Career screen prints. Client-safe and
 * pure, so the tab and the web panel (components/career/panel/) say the same
 * thing the same way.
 */
import { quantities } from '@/lib/career/truth';
import type { ApplicationStatus, ApplyRoute, CareerJob, Prediction, SalaryPeriod, SourceId } from '@/lib/career/types';
import type { CareerHome } from '@/lib/career/view';

const DAY_MS = 86_400_000;

// ─── Score bands ─────────────────────────────────────────────────────────

export type ScoreBand = 'strong' | 'good' | 'fair' | 'low' | 'none';

/** The band a score falls in, and the word printed beside its colour. */
export function scoreBand(score: number | null): { band: ScoreBand; word: string } {
  if (score === null) return { band: 'none', word: 'Not scored yet' };
  if (score >= 75) return { band: 'strong', word: 'Strong match' };
  if (score >= 50) return { band: 'good', word: 'Good match' };
  if (score >= 30) return { band: 'fair', word: 'Partial match' };
  return { band: 'low', word: 'Weak match' };
}

// ─── Money ───────────────────────────────────────────────────────────────

const PERIOD_WORD: Record<SalaryPeriod, string> = { year: 'a year', month: 'a month', hour: 'an hour' };

const CURRENCY_SIGN: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£', CAD: 'C$', AUD: 'A$', SGD: 'S$' };

function sign(currency: string) {
  return CURRENCY_SIGN[currency.toUpperCase()] ?? `${currency.toUpperCase()} `;
}

function trimmed(value: number) {
  return value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
}

/** One amount, short: ₹32 L, ₹1.2 Cr, $140k, €900. Rupees count in lakhs and crores. */
export function moneyShort(amount: number, currency: string): string {
  const upper = currency.toUpperCase();
  if (upper === 'INR') {
    if (amount >= 1e7) return `₹${trimmed(amount / 1e7)} Cr`;
    if (amount >= 1e5) return `₹${trimmed(amount / 1e5)} L`;
    return `₹${Math.round(amount).toLocaleString('en-IN')}`;
  }
  if (amount >= 1e6) return `${sign(upper)}${trimmed(amount / 1e6)}M`;
  if (amount >= 1e4) return `${sign(upper)}${trimmed(amount / 1e3)}k`;
  return `${sign(upper)}${Math.round(amount).toLocaleString('en-US')}`;
}

type SalaryLike = { min: number | null; max: number | null; currency: string; period: SalaryPeriod };

/** "₹30–45 L a year", "From $120k a year", or null when nothing is known. */
export function salaryText(salary: SalaryLike | null | undefined): string | null {
  if (!salary || (salary.min === null && salary.max === null)) return null;
  const period = PERIOD_WORD[salary.period];
  if (salary.min !== null && salary.max !== null && salary.min !== salary.max) {
    const low = moneyShort(salary.min, salary.currency);
    const high = moneyShort(salary.max, salary.currency);
    // "₹30 L–₹45 L" says the sign and unit twice: "₹30–45 L" once.
    const unit = /\s(L|Cr)$/.exec(high)?.[1];
    const lowPart = unit && low.endsWith(` ${unit}`) ? low.slice(0, -(unit.length + 1)) : low;
    const highPart = high.replace(/^\D+/, '');
    return `${lowPart}–${highPart} ${period}`;
  }
  if (salary.min !== null && salary.max === null) return `From ${moneyShort(salary.min, salary.currency)} ${period}`;
  if (salary.min === null && salary.max !== null) return `Up to ${moneyShort(salary.max, salary.currency)} ${period}`;
  return `${moneyShort(salary.min ?? 0, salary.currency)} ${period}`;
}

export function periodWord(period: SalaryPeriod) {
  return PERIOD_WORD[period];
}

// ─── Dates ───────────────────────────────────────────────────────────────

/** Whole days from `iso` to `now`, never negative. */
export function daysSince(iso: string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / DAY_MS));
}

/** "Posted today", "Posted 3 days ago", "Found 2 weeks ago". */
export function freshness(job: Pick<CareerJob, 'postedAt' | 'foundAt'>, now: Date = new Date()): { text: string; stale: boolean } {
  const verb = job.postedAt ? 'Posted' : 'Found';
  const days = daysSince(job.postedAt ?? job.foundAt, now);
  const stale = days > 14;
  if (days === 0) return { text: `${verb} today`, stale };
  if (days === 1) return { text: `${verb} yesterday`, stale };
  if (days < 14) return { text: `${verb} ${days} days ago`, stale };
  return { text: `${verb} ${Math.floor(days / 7)} weeks ago`, stale };
}

/** "27 Oct", in India time. */
export function dayMonth(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}

/** "Tue 28 Oct, 3:00 pm", in India time. */
export function dayTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

/** "Mar 2021", from 'YYYY-MM'. */
export function monthYear(yearMonth: string | null): string {
  if (!yearMonth) return 'now';
  const [year, month] = yearMonth.split('-');
  if (!month) return year;
  return new Date(Date.UTC(Number(year), Number(month) - 1, 1)).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// ─── Chances ─────────────────────────────────────────────────────────────

const pct = (value: number) => Math.round(value * 100);

/** "18–31%": a chance is always a range, never a bare figure. */
export function rangeText([low, high]: readonly [number, number]): string {
  const from = pct(low);
  const to = pct(high);
  return from === to ? `about ${from}%` : `${from}–${to}%`;
}

/** The reply chance as a sentence, and whether it is still an early estimate. */
export function replyChance(prediction: Prediction | null): { text: string; note: string } | null {
  if (!prediction) return null;
  const note = prediction.early
    ? 'Early estimate'
    : `Learned from ${prediction.basedOn} of your outcomes`;
  return { text: `Reply chance ${rangeText(prediction.replyRange)}`, note };
}

/** "2–5", "about 3": a count range from the forecast. */
export function countRange([low, high]: readonly [number, number]): string {
  const from = Math.round(low);
  const to = Math.round(high);
  return from === to ? `about ${from}` : `${from}–${to}`;
}

// ─── Sources ─────────────────────────────────────────────────────────────

export const SOURCE_NAME: Record<SourceId, string> = {
  gmail_alerts: 'Job-alert emails',
  himalayas: 'Himalayas',
  remotive: 'Remotive',
  remoteok: 'Remote OK',
  wwr: 'We Work Remotely',
  jobspresso: 'Jobspresso',
  hn: 'Hacker News “Who is hiring”',
  adzuna: 'Adzuna',
  greenhouse: 'Greenhouse boards',
  lever: 'Lever boards',
  ashby: 'Ashby boards',
  recruitee: 'Recruitee boards',
  pasted: 'Jobs you paste',
};

/** How each source must be credited on screen, per its terms (design: Sources). */
export const SOURCE_CREDIT: Record<SourceId, string> = {
  gmail_alerts: 'From your job alerts',
  himalayas: 'via Himalayas',
  remotive: 'via Remotive',
  remoteok: 'via Remote OK',
  wwr: 'via We Work Remotely',
  jobspresso: 'via Jobspresso',
  hn: 'via Hacker News',
  adzuna: 'Jobs by Adzuna',
  greenhouse: 'via Greenhouse',
  lever: 'via Lever',
  ashby: 'via Ashby',
  recruitee: 'via Recruitee',
  pasted: 'Pasted by you',
};

/** What each source is, in a line, for Setup. */
export const SOURCE_NOTE: Record<SourceId, string> = {
  gmail_alerts: 'LinkedIn, Indeed, Naukri and others, read only from the alert emails in your Gmail. Never scraped.',
  himalayas: 'Remote jobs, synced at most once a day.',
  remotive: 'Remote jobs, fetched at most four times a day.',
  remoteok: 'Remote jobs from its public feed.',
  wwr: 'Remote jobs from its RSS feeds.',
  jobspresso: 'Remote jobs from its RSS feed.',
  hn: 'The monthly thread on Hacker News. Some posts take applications by email.',
  adzuna: 'A large job index. Needs its keys on the server.',
  greenhouse: 'Companies on your watchlist that hire through Greenhouse.',
  lever: 'Companies on your watchlist that hire through Lever.',
  ashby: 'Companies on your watchlist that hire through Ashby.',
  recruitee: 'Companies on your watchlist that hire through Recruitee. Orbis can apply there directly.',
  pasted: 'Jobs you paste in yourself.',
};

/** The credit to print for a job: the source's own wording when it gave one. */
export function creditFor(job: Pick<CareerJob, 'source' | 'attribution'>): string {
  return job.attribution ?? SOURCE_CREDIT[job.source];
}

// ─── Statuses and routes ─────────────────────────────────────────────────

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  drafting: 'Drafting',
  ready: 'Ready to send',
  sending: 'Sending',
  opened: 'Waiting for “I applied”',
  sent: 'Sent',
  acknowledged: 'Acknowledged',
  replied: 'Replied',
  assessment: 'Assessment',
  interview: 'Interview',
  offer: 'Offer',
  accepted: 'Accepted',
  declined: 'Declined',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  ghosted: 'No reply',
  failed: 'Failed',
};

/** How the application leaves Orbis, said plainly. */
export function routeText(route: ApplyRoute, canSend: boolean): { title: string; body: string } {
  if (route === 'email' && canSend) return { title: 'Sent from your Gmail', body: 'Send emails the company from your own Gmail, with the tailored PDF attached and the cover note as the message.' };
  if (route === 'email') return { title: 'Opens in Gmail', body: 'Orbis isn’t allowed to send from your Gmail, so Send opens a ready email. Attach the PDF, send it, then press “I applied”.' };
  if (route === 'recruitee') return { title: 'Posted to the company’s Recruitee page', body: 'Send posts your details, cover note and PDF to their careers page. If it refuses, Orbis falls back to opening the page for you.' };
  return { title: 'You apply on their site', body: 'Send opens the apply page in a new tab, with every field ready to copy. Press “I applied” once it’s in.' };
}

// ─── The tab's headline ──────────────────────────────────────────────────

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The one line that matters most right now, for the tab's header. */
export function homeHeadline(home: CareerHome, now: Date = new Date()): string {
  const soon = home.upcoming.find((item) => item.at && Date.parse(item.at) - now.getTime() < DAY_MS && Date.parse(item.at) > now.getTime());
  if (soon?.at) return `Interview with ${soon.job.company} at ${dayTime(soon.at)}.`;
  if (home.counts.offers > 0) return `${plural(home.counts.offers, 'offer is', 'offers are')} waiting for your answer.`;
  if (home.counts.queue > 0) return `${plural(home.counts.queue, 'application is', 'applications are')} ready for your Send.`;
  if (home.followUps.length > 0) return `${plural(home.followUps.length, 'follow-up is', 'follow-ups are')} due today.`;
  if (home.counts.forYou > 0) return `${plural(home.counts.forYou, 'new match', 'new matches')} above your bar.`;
  if (home.state.lastIngestAt) return `Nothing new above your bar since ${dayMonth(home.state.lastIngestAt)}. Orbis keeps looking.`;
  return 'Orbis runs your first search once your resume and spec are in.';
}

// ─── Owner-typed numbers ─────────────────────────────────────────────────

/**
 * The numbers in `text` that none of `factTexts` contains: the ones the owner
 * typed. They're allowed (they're theirs) but shown highlighted, so a slip
 * like "15 years" for "5 years" is seen before it goes out.
 */
export function ownerNumbers(text: string, factTexts: readonly string[]): string[] {
  const known = factTexts.flatMap((fact) => quantities(fact).map((quantity) => quantity.value));
  const close = (left: number, right: number) => Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));
  const raw = quantities(text).filter((quantity) => !known.some((value) => close(value, quantity.value))).map((quantity) => quantity.raw);
  return [...new Set(raw)];
}

/** Splits `text` around each of `marks`, for highlighting. */
export function splitMarks(text: string, marks: readonly string[]): Array<{ text: string; mark: boolean }> {
  if (!marks.length) return [{ text, mark: false }];
  const escaped = [...marks].sort((left, right) => right.length - left.length).map((mark) => mark.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'g');
  return text.split(pattern).filter(Boolean).map((part) => ({ text: part, mark: marks.includes(part) }));
}
