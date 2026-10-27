/**
 * CareerHome from what the database returned: the queue, the pipeline, what's
 * coming up, the follow-ups due, recent activity and the week's numbers. Pure,
 * so the composition is tested apart from the reads (app/career/actions.ts).
 */
import type { ApplicationStatus, CareerApplication, CareerEvent, CareerJob, CareerState } from './types.ts';
import type { ApplicationCard, CareerHome, UpcomingInterview } from './view.ts';
import { isFollowUpDue } from './followup.ts';
import { hadReply } from './status.ts';

/** Descriptions are up to 20 kB each; lists only need to know there is one. The sheet loads the job in full. */
export const CARD_DESCRIPTION_CHARS = 300;
export const HOT_MATCHES = 6;
export const RECENT_EVENTS = 20;
/** Below this many sent applications a reply rate says more about luck than the search. */
export const MIN_SENT_FOR_RATE = 5;
// An interview that started up to this long ago is still "upcoming" (it may be running).
const UPCOMING_GRACE_MS = 2 * 3_600_000;
const DAY_MS = 86_400_000;

/** The job with its description cut short, for lists. */
export function cardJob(job: CareerJob): CareerJob {
  if (!job.description || job.description.length <= CARD_DESCRIPTION_CHARS) return job;
  return { ...job, description: `${job.description.slice(0, CARD_DESCRIPTION_CHARS - 1).trimEnd()}…` };
}

/** The calendar day ('YYYY-MM-DD') an instant falls on in `timeZone`. */
export function localDay(iso: string | Date, timeZone: string): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The Monday on or before `day`. */
export function weekStart(day: string): string {
  const time = Date.parse(`${day}T00:00:00Z`);
  const weekday = (new Date(time).getUTCDay() + 6) % 7;
  return new Date(time - weekday * DAY_MS).toISOString().slice(0, 10);
}

function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

const str = (value: unknown) => (typeof value === 'string' && value ? value : null);

/** When, how and where an interview is: the prep pack's logistics first, else the invite's details. */
function interviewOf(app: CareerApplication, invites: readonly CareerEvent[]) {
  const invite = invites.find((event) => event.applicationId === app.id);
  return {
    at: app.prep?.logistics.at ?? str(invite?.details.interviewAt),
    format: app.prep?.logistics.format ?? str(invite?.details.interviewFormat),
    link: app.prep?.logistics.link ?? str(invite?.details.meetingLink),
  };
}

function upcomingOf(cards: readonly ApplicationCard[], events: readonly CareerEvent[], now: Date): UpcomingInterview[] {
  const invites = events.filter((event) => event.kind === 'interview_invite');
  const list = cards
    .filter((card) => card.application.status === 'interview')
    .map((card) => ({ ...card, ...interviewOf(card.application, invites) }))
    .filter((item) => item.at === null || Date.parse(item.at) >= now.getTime() - UPCOMING_GRACE_MS);
  // Dated ones soonest first; undated ones after them.
  return list.sort((a, b) => {
    if (a.at === null || b.at === null) return Number(a.at === null) - Number(b.at === null);
    return Date.parse(a.at) - Date.parse(b.at);
  });
}

const AWAITING: readonly ApplicationStatus[] = ['sent', 'acknowledged'];

/** A follow-up drafted and waiting for Send, or one whose day has come. */
function followUpWaiting(app: CareerApplication, today: string): boolean {
  if (!AWAITING.includes(app.status)) return false;
  return Boolean(app.followUpDraft) || isFollowUpDue(app, today);
}

const activity = (app: CareerApplication) => app.lastEventAt ?? app.updatedAt;

export function weekNumbers(input: {
  applications: readonly CareerApplication[];
  events: readonly CareerEvent[];
  goal: number;
  today: string;
  timeZone: string;
}): CareerHome['week'] {
  const start = weekStart(input.today);
  const end = shiftDay(start, 7);
  const lastStart = shiftDay(start, -7);
  const inRange = (iso: string, from: string, to: string) => {
    const day = localDay(iso, input.timeZone);
    return day >= from && day < to;
  };
  const sentApps = input.applications.filter((app): app is CareerApplication & { sentAt: string } => app.sentAt !== null);
  const replied = sentApps.filter((app) => hadReply(app.status)).length;
  return {
    sent: sentApps.filter((app) => inRange(app.sentAt, start, end)).length,
    goal: input.goal,
    sentLastWeek: sentApps.filter((app) => inRange(app.sentAt, lastStart, start)).length,
    interviews: input.events.filter((event) => event.kind === 'interview_invite' && event.applicationId && inRange(event.at, start, end)).length,
    replyRate: sentApps.length < MIN_SENT_FOR_RATE ? null : Math.round((replied / sentApps.length) * 100) / 100,
  };
}

export type HomeInput = {
  state: CareerState;
  applications: readonly CareerApplication[];
  jobs: readonly CareerJob[];
  /** Newest first; the latest few hundred are plenty. */
  events: readonly CareerEvent[];
  unmatched: readonly CareerEvent[];
  hotMatches: readonly CareerJob[];
  forYouCount: number;
  now: Date;
  timeZone: string;
};

export function composeHome(input: HomeInput): CareerHome {
  const today = localDay(input.now, input.timeZone);
  const jobs = new Map(input.jobs.map((job) => [job.id, cardJob(job)]));
  const cards: ApplicationCard[] = input.applications.flatMap((application) => {
    const job = jobs.get(application.jobId);
    return job ? [{ application, job }] : [];
  });
  const byActivity = (a: ApplicationCard, b: ApplicationCard) => activity(b.application).localeCompare(activity(a.application));

  const queue = cards.filter((card) => card.application.status === 'ready')
    .sort((a, b) => (b.job.score ?? 0) - (a.job.score ?? 0) || byActivity(a, b));
  const pipeline = cards.filter((card) => card.application.status !== 'drafting').sort(byActivity);
  const followUps = cards.filter((card) => followUpWaiting(card.application, today)).sort(byActivity);
  const byApplication = new Map(cards.map((card) => [card.application.id, card.job]));
  const recent = input.events.slice(0, RECENT_EVENTS).map((event) => {
    const job = event.applicationId ? byApplication.get(event.applicationId) : undefined;
    return { ...event, company: job?.company ?? null, title: job?.title ?? null };
  });
  const count = (status: ApplicationStatus) => input.applications.filter((app) => app.status === status).length;

  return {
    state: input.state,
    counts: {
      forYou: input.forYouCount,
      queue: queue.length,
      interviews: count('interview'),
      offers: count('offer'),
      unmatched: input.unmatched.length,
    },
    hotMatches: input.hotMatches.slice(0, HOT_MATCHES).map(cardJob),
    queue,
    pipeline,
    upcoming: upcomingOf(cards, input.events, input.now),
    followUps,
    recent,
    unmatched: [...input.unmatched],
    week: weekNumbers({ applications: input.applications, events: input.events, goal: input.state.settings.weeklyGoal, today, timeZone: input.timeZone }),
    insights: null,
  };
}
