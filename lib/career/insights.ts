/**
 * The Insights cards: skill gaps, salary and market pulse, sources, freshness,
 * best day and the weekly funnel. Pure.
 *
 * Each card either rests on enough data or says how much more it needs. The
 * skill-gap radar is exact (a counterfactual rescore), not a guess.
 */
import type { ApplicationStatus, CareerEvent, CareerInsights, EventKind, Prediction, SalaryPeriod, SalaryPulse, SkillGap, SourceId } from './types.ts';
import { daysBetween, dayOf } from './followup.ts';
import { forecast } from './predict.ts';
import { hadReply } from './status.ts';

const DAY_MS = 86_400_000;

// ─── Weeks ───────────────────────────────────────────────────────────────

/** The ISO 8601 week of a date, 'YYYY-Www' (weeks start Monday; week 1 holds the first Thursday). */
export function isoWeek(iso: string): string {
  const date = new Date(`${dayOf(iso)}T00:00:00Z`);
  const weekday = date.getUTCDay() || 7;
  // The Thursday of this week decides which year the week belongs to.
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const year = date.getUTCFullYear();
  const week = Math.ceil(((date.getTime() - Date.UTC(year, 0, 1)) / DAY_MS + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** The last `weeks` ISO weeks up to and including today's, oldest first. */
export function recentWeeks(today: string, weeks: number): string[] {
  const end = Date.parse(`${dayOf(today)}T00:00:00Z`);
  const out: string[] = [];
  for (let back = weeks - 1; back >= 0; back -= 1) {
    out.push(isoWeek(new Date(end - back * 7 * DAY_MS).toISOString()));
  }
  return out;
}

// ─── Skill gaps ──────────────────────────────────────────────────────────

/** A skill must be missing from at least this many jobs to count as a gap, not a one-off. */
export const MIN_GAP_JOBS = 2;
export const MAX_GAPS = 10;

type GapTally = { skill: string; jobIds: string[] };

function tallyMissing(jobs: Array<{ id: string; missingMust: string[] }>) {
  const tally = new Map<string, GapTally>();
  for (const job of jobs) {
    const seen = new Set<string>();
    for (const skill of job.missingMust) {
      const key = skill.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const entry = tally.get(key) ?? { skill: skill.trim(), jobIds: [] };
      entry.jobIds.push(job.id);
      tally.set(key, entry);
    }
  }
  return [...tally.values()];
}

/**
 * Must-haves the owner lacks that recur across scored jobs, and how many
 * below-threshold jobs would cross it with that one skill added (each job
 * rescored by `rescoreWith`, the real match function).
 */
export function skillGaps(input: {
  jobs: Array<{ id: string; score: number; missingMust: string[] }>;
  threshold: number;
  rescoreWith: (jobId: string, skill: string) => number;
}): SkillGap[] {
  const scores = new Map(input.jobs.map((job) => [job.id, job.score]));
  const gaps: SkillGap[] = [];
  for (const entry of tallyMissing(input.jobs)) {
    if (entry.jobIds.length < MIN_GAP_JOBS) continue;
    let unlock = 0;
    for (const jobId of entry.jobIds) {
      const before = scores.get(jobId) ?? 0;
      if (before < input.threshold && input.rescoreWith(jobId, entry.skill) >= input.threshold) unlock += 1;
    }
    gaps.push({ skill: entry.skill, jobsMissingIt: entry.jobIds.length, jobsItWouldUnlock: unlock });
  }
  gaps.sort((a, b) => b.jobsItWouldUnlock - a.jobsItWouldUnlock || b.jobsMissingIt - a.jobsMissingIt || a.skill.localeCompare(b.skill));
  return gaps.slice(0, MAX_GAPS);
}

// ─── Salary pulse ────────────────────────────────────────────────────────

export const MIN_SALARY_SAMPLE = 5;

type StatedSalary = { min: number | null; max: number | null; currency: string; period: SalaryPeriod } | null;

/** One number per listing: the midpoint of a range, or the one end stated. */
function midpoint(salary: StatedSalary): number | null {
  if (!salary) return null;
  const { min, max } = salary;
  const value = min !== null && max !== null ? (min + max) / 2 : (min ?? max);
  return value !== null && value > 0 ? value : null;
}

/** The q-th quantile (0–1) of sorted values, interpolated between neighbours. */
export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * q;
  const below = Math.floor(position);
  const above = Math.min(below + 1, sorted.length - 1);
  return sorted[below] + (sorted[above] - sorted[below]) * (position - below);
}

/** p25/p50/p75 of stated pay in the owner's role, per currency and period, where there are 5 or more listings. */
export function salaryPulse(jobs: Array<{ title: string; salary: StatedSalary }>, roleMatch: (title: string) => boolean): SalaryPulse[] {
  const groups = new Map<string, { currency: string; period: SalaryPeriod; values: number[] }>();
  for (const job of jobs) {
    const value = midpoint(job.salary);
    if (value === null || !job.salary || !roleMatch(job.title)) continue;
    const currency = job.salary.currency.toUpperCase();
    const key = `${currency}|${job.salary.period}`;
    const group = groups.get(key) ?? { currency, period: job.salary.period, values: [] };
    group.values.push(value);
    groups.set(key, group);
  }
  const out: SalaryPulse[] = [];
  for (const group of groups.values()) {
    if (group.values.length < MIN_SALARY_SAMPLE) continue;
    const sorted = [...group.values].sort((a, b) => a - b);
    out.push({
      currency: group.currency,
      period: group.period,
      p25: Math.round(quantile(sorted, 0.25)),
      p50: Math.round(quantile(sorted, 0.5)),
      p75: Math.round(quantile(sorted, 0.75)),
      sample: sorted.length,
    });
  }
  return out.sort((a, b) => b.sample - a.sample);
}

// ─── Market and sources ──────────────────────────────────────────────────

/** Matching jobs found per ISO week over the last `weeks`, oldest first, empty weeks included. */
export function marketPulse(jobs: Array<{ foundAt: string; score: number | null }>, threshold: number, today: string, weeks = 8): CareerInsights['market'] {
  const counts = new Map(recentWeeks(today, weeks).map((week) => [week, 0]));
  for (const job of jobs) {
    if (job.score === null || job.score < threshold) continue;
    const week = isoWeek(job.foundAt);
    const count = counts.get(week);
    if (count !== undefined) counts.set(week, count + 1);
  }
  return [...counts].map(([week, count]) => ({ week, jobs: count }));
}

/** Per source: jobs found, matches, applications sent, and replies. Credited to the source a job came from first. */
export function sourceStats(
  jobs: Array<{ id: string; source: SourceId; score: number | null }>,
  applications: Array<{ jobId: string; status: ApplicationStatus; sentAt: string | null }>,
  threshold: number,
): CareerInsights['sources'] {
  const byJob = new Map(applications.map((app) => [app.jobId, app]));
  const stats = new Map<SourceId, CareerInsights['sources'][number]>();
  for (const job of jobs) {
    const row = stats.get(job.source) ?? { source: job.source, jobs: 0, matches: 0, applied: 0, replies: 0 };
    row.jobs += 1;
    if (job.score !== null && job.score >= threshold) row.matches += 1;
    const app = byJob.get(job.id);
    if (app?.sentAt) row.applied += 1;
    if (app && hadReply(app.status)) row.replies += 1;
    stats.set(job.source, row);
  }
  return [...stats.values()].sort((a, b) => b.matches - a.matches || b.jobs - a.jobs);
}

// ─── Freshness and best day ──────────────────────────────────────────────

export const MIN_FRESHNESS_OUTCOMES = 20;
const MIN_BUCKET = 5;
export const FRESHNESS_PRIOR = 'Apply within 2 days of posting';

const FRESHNESS_BUCKETS = [
  { label: 'within 2 days of posting', max: 2 },
  { label: '3–7 days after posting', max: 7 },
  { label: '8–14 days after posting', max: 14 },
  { label: '15 or more days after posting', max: Number.POSITIVE_INFINITY },
];

const percent = (share: number) => `${Math.round(share * 100)}%`;

/** Reply rate by how fresh the listing was, once there are 20 resolved outcomes; the prior until then. */
export function freshnessAdvice(outcomes: Array<{ freshnessDays: number | null; replied: boolean }>): CareerInsights['freshness'] {
  const known = outcomes.filter((outcome) => outcome.freshnessDays !== null);
  const prior = { advice: FRESHNESS_PRIOR, fromData: false };
  if (known.length < MIN_FRESHNESS_OUTCOMES) return prior;
  const overall = known.filter((outcome) => outcome.replied).length / known.length;
  const tallies = FRESHNESS_BUCKETS.map((bucket) => ({ label: bucket.label, replied: 0, total: 0 }));
  for (const outcome of known) {
    const days = outcome.freshnessDays ?? 0;
    const tally = tallies[FRESHNESS_BUCKETS.findIndex((bucket) => days <= bucket.max)];
    tally.total += 1;
    if (outcome.replied) tally.replied += 1;
  }
  let best: (typeof tallies)[number] | null = null;
  for (const tally of tallies) {
    if (tally.total < MIN_BUCKET) continue;
    if (!best || tally.replied / tally.total > best.replied / best.total) best = tally;
  }
  if (!best) return prior;
  const rate = best.replied / best.total;
  return {
    advice: `Replies came most often when you applied ${best.label}: ${best.replied} of ${best.total} (${percent(rate)}), against ${percent(overall)} overall.`,
    fromData: true,
  };
}

export const MIN_BEST_DAY_SENT = 30;
const MIN_DAY_SAMPLE = 3;

function weekdayOf(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone }).format(new Date(iso));
}

/** The weekday with the best reply rate, once 30 applications have gone out; otherwise how many more are needed. */
export function bestDay(sent: Array<{ sentAt: string; replied: boolean }>, timeZone = 'UTC'): CareerInsights['bestDay'] {
  if (sent.length < MIN_BEST_DAY_SENT) return { day: null, needMore: MIN_BEST_DAY_SENT - sent.length };
  const days = new Map<string, { sent: number; replied: number }>();
  for (const app of sent) {
    const day = weekdayOf(app.sentAt, timeZone);
    const tally = days.get(day) ?? { sent: 0, replied: 0 };
    tally.sent += 1;
    if (app.replied) tally.replied += 1;
    days.set(day, tally);
  }
  let best: { day: string; rate: number; sent: number } | null = null;
  for (const [day, tally] of days) {
    if (tally.sent < MIN_DAY_SAMPLE) continue;
    const rate = tally.replied / tally.sent;
    const better = !best || rate > best.rate || (rate === best.rate && tally.sent > best.sent);
    if (better) best = { day, rate, sent: tally.sent };
  }
  return { day: best?.day ?? null, needMore: 0 };
}

// ─── Funnel ──────────────────────────────────────────────────────────────

const REPLY_EVENTS: readonly EventKind[] = ['reply', 'recruiter_question', 'assessment', 'interview_invite', 'rejection', 'offer'];

/** Per ISO week: applications sent, applications that got a reply, applications invited to interview. */
export function funnel(events: Array<Pick<CareerEvent, 'id' | 'kind' | 'at' | 'applicationId'>>, today: string, weeks = 8): CareerInsights['funnel'] {
  const rows = new Map(recentWeeks(today, weeks).map((week) => [week, { sent: new Set<string>(), replies: new Set<string>(), interviews: new Set<string>() }]));
  for (const event of events) {
    const row = rows.get(isoWeek(event.at));
    if (!row) continue;
    // Unmatched replies have no application; each still counts once.
    const key = event.applicationId ?? event.id;
    if (event.kind === 'sent') row.sent.add(key);
    if (REPLY_EVENTS.includes(event.kind)) row.replies.add(key);
    if (event.kind === 'interview_invite') row.interviews.add(key);
  }
  return [...rows].map(([week, row]) => ({ week, sent: row.sent.size, replies: row.replies.size, interviews: row.interviews.size }));
}

// ─── Everything ──────────────────────────────────────────────────────────

export type InsightsInput = {
  today: string;
  threshold: number;
  /** The owner's IANA zone, for the best-day card. */
  timeZone: string;
  jobs: Array<{ id: string; source: SourceId; title: string; score: number | null; foundAt: string; salary: StatedSalary; missingMust: string[] }>;
  applications: Array<{ jobId: string; status: ApplicationStatus; sentAt: string | null; prediction: Prediction | null; freshnessDays: number | null }>;
  events: Array<Pick<CareerEvent, 'id' | 'kind' | 'at' | 'applicationId'>>;
  /** Days from sending to the first reply, for every application that got one. */
  replyDelayDays: number[];
  rescoreWith: (jobId: string, skill: string) => number;
  roleMatch: (title: string) => boolean;
};

const AWAITING: readonly ApplicationStatus[] = ['sent', 'acknowledged'];

export function buildInsights(input: InsightsInput): CareerInsights {
  const sent = input.applications.filter((app): app is typeof app & { sentAt: string } => app.sentAt !== null);
  const waiting = sent.flatMap((app) => (AWAITING.includes(app.status) && app.prediction ? [{ prediction: app.prediction, sentAt: app.sentAt }] : []));
  // Resolved only: an answer, or silence long enough to be called ghosted.
  const resolved = sent.filter((app) => hadReply(app.status) || app.status === 'ghosted');
  const scored = input.jobs.flatMap((job) => (job.score === null ? [] : [{ id: job.id, score: job.score, missingMust: job.missingMust }]));
  return {
    forecast: forecast(waiting, input.replyDelayDays, input.today),
    skillGaps: skillGaps({ jobs: scored, threshold: input.threshold, rescoreWith: input.rescoreWith }),
    salary: salaryPulse(input.jobs, input.roleMatch),
    market: marketPulse(input.jobs, input.threshold, input.today),
    sources: sourceStats(input.jobs, input.applications, input.threshold),
    freshness: freshnessAdvice(resolved.map((app) => ({ freshnessDays: app.freshnessDays, replied: hadReply(app.status) }))),
    bestDay: bestDay(sent.map((app) => ({ sentAt: app.sentAt, replied: hadReply(app.status) })), input.timeZone),
    funnel: funnel(input.events, input.today),
  };
}

/** Days from sending to the first reply event, per application, for the forecast. */
export function replyDelays(applications: Array<{ id: string; sentAt: string | null }>, events: Array<Pick<CareerEvent, 'kind' | 'at' | 'applicationId'>>): number[] {
  const first = new Map<string, string>();
  for (const event of events) {
    if (!event.applicationId || !REPLY_EVENTS.includes(event.kind)) continue;
    const seen = first.get(event.applicationId);
    if (!seen || event.at < seen) first.set(event.applicationId, event.at);
  }
  return applications.flatMap((app) => {
    const at = first.get(app.id);
    return app.sentAt && at ? [Math.max(0, daysBetween(app.sentAt, at))] : [];
  });
}
