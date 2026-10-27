/**
 * The web panel's numbers, worked out from what loadCareerAction returns.
 * Pure and client-safe: every view in components/career/panel/ reads these
 * instead of counting for itself, so the title chips, the bento cards and the
 * header badges always agree.
 */
import { dayTime } from '@/components/career/format';
import { STAGE_GROUPS, groupOf, isOpen, type StageGroupId } from '@/lib/career/status';
import type { CareerEvent, CareerJob } from '@/lib/career/types';
import type { ApplicationCard, CareerHome } from '@/lib/career/view';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** India time, which every Career date on screen uses (format.ts). */
const IST_OFFSET_MS = 330 * MINUTE_MS;

// ─── Pages ───────────────────────────────────────────────────────────────

export const PANEL_PAGES = ['overview', 'pipeline', 'jobs', 'interviews', 'offers', 'insights', 'setup'] as const;
export type PanelPage = (typeof PANEL_PAGES)[number];

/** The nav's word, and the page's two-line title. */
export const PAGE_META: Record<PanelPage, { label: string; title: readonly [string, string] }> = {
  overview: { label: 'Overview', title: ['Career', 'Overview'] },
  pipeline: { label: 'Pipeline', title: ['Application', 'Pipeline'] },
  jobs: { label: 'Jobs', title: ['Job', 'Matches'] },
  interviews: { label: 'Interviews', title: ['Interview', 'Agenda'] },
  offers: { label: 'Offers', title: ['Offer', 'Desk'] },
  insights: { label: 'Insights', title: ['Market', 'Insights'] },
  setup: { label: 'Setup', title: ['Career', 'Setup'] },
};

/** "#/pipeline" → 'pipeline'; anything unknown is the Overview. */
export function pageFromHash(hash: string): PanelPage {
  const id = hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return (PANEL_PAGES as readonly string[]).includes(id) ? (id as PanelPage) : 'overview';
}

export const hrefFor = (page: PanelPage) => `#/${page}`;

// ─── Time ────────────────────────────────────────────────────────────────

/** "just now", "12 min ago", "3 h ago", "yesterday", "4 days ago", then the date. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const gap = now.getTime() - Date.parse(iso);
  if (Number.isNaN(gap)) return '';
  if (gap < MINUTE_MS) return 'just now';
  if (gap < HOUR_MS) return `${Math.floor(gap / MINUTE_MS)} min ago`;
  if (gap < DAY_MS) return `${Math.floor(gap / HOUR_MS)} h ago`;
  const days = Math.floor(gap / DAY_MS);
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}

/** "in 3 h", "tomorrow", "in 4 days": how far off a future moment is. */
export function untilText(iso: string, now: Date = new Date()): string {
  const gap = Date.parse(iso) - now.getTime();
  if (gap <= 0) return 'now';
  if (gap < HOUR_MS) return `in ${Math.max(1, Math.round(gap / MINUTE_MS))} min`;
  if (gap < DAY_MS) return `in ${Math.round(gap / HOUR_MS)} h`;
  const days = Math.round(gap / DAY_MS);
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

/** The calendar day in India time, as 'YYYY-MM-DD'. */
export function istDay(value: Date | string): string {
  const time = typeof value === 'string' ? Date.parse(value) : value.getTime();
  return new Date(time + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The ISO week a moment falls in, in India time: '2026-W44'. Matches insights.funnel's keys. */
export function isoWeek(value: Date | string): string {
  const time = typeof value === 'string' ? Date.parse(value) : value.getTime();
  const local = new Date(time + IST_OFFSET_MS);
  const day = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  // The Thursday of this week decides the year it belongs to.
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** The Monday that starts the week `back` weeks before `now`'s, in India time. */
function weekStart(now: Date, back: number): Date {
  const local = new Date(now.getTime() + IST_OFFSET_MS);
  const monday = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() || 7) - 1) - back * 7);
  return monday;
}

// ─── Applications ────────────────────────────────────────────────────────

/** Every application the home knows, once each: the queue's drafts and the pipeline. */
export function allApplications(home: CareerHome): ApplicationCard[] {
  const seen = new Set<string>();
  const out: ApplicationCard[] = [];
  for (const card of [...home.queue, ...home.pipeline]) {
    if (seen.has(card.application.id)) continue;
    seen.add(card.application.id);
    out.push(card);
  }
  return out;
}

/** The newest event per application, from the home's recent list. */
export function latestEvents(home: CareerHome): Map<string, CareerEvent> {
  const latest = new Map<string, CareerEvent>();
  for (const event of home.recent) {
    if (!event.applicationId) continue;
    const known = latest.get(event.applicationId);
    if (!known || known.at < event.at) latest.set(event.applicationId, event);
  }
  return latest;
}

export type StageCount = { id: StageGroupId; label: string; count: number; share: number };

/** How many applications sit in each stage, in board order. */
export function stageMix(cards: readonly ApplicationCard[]): StageCount[] {
  const total = cards.length;
  return STAGE_GROUPS.map((group) => {
    const count = cards.filter((card) => group.statuses.includes(card.application.status)).length;
    return { id: group.id, label: group.label, count, share: total ? count / total : 0 };
  });
}

/** Open (sent and still in play) applications. */
export function openCount(cards: readonly ApplicationCard[]): number {
  return cards.filter((card) => isOpen(card.application.status)).length;
}

// ─── The weekly chart ────────────────────────────────────────────────────

export type WeekPoint = { week: string; label: string; sent: number; replies: number; interviews: number };

const REPLY_EVENTS = new Set(['reply', 'recruiter_question', 'assessment', 'rejection', 'offer']);

/**
 * Sent, replies and interviews per week for the last `weeks` weeks, oldest
 * first. insights.funnel is the record when it's there; until it is, sent
 * comes from each application's sentAt and replies and interviews from the
 * recent events, which only reach back so far (`partial` says so).
 */
export function weeklySeries(home: CareerHome, weeks: number, now: Date = new Date()): { points: WeekPoint[]; partial: boolean; empty: boolean } {
  const funnel = home.insights?.funnel ?? [];
  const byWeek = new Map<string, WeekPoint>();
  for (let back = weeks - 1; back >= 0; back -= 1) {
    const start = weekStart(now, back);
    const week = isoWeek(new Date(start.getTime() + 12 * HOUR_MS - IST_OFFSET_MS));
    const label = start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    byWeek.set(week, { week, label, sent: 0, replies: 0, interviews: 0 });
  }
  const partial = funnel.length === 0;
  if (partial) {
    for (const card of allApplications(home)) {
      const point = card.application.sentAt ? byWeek.get(isoWeek(card.application.sentAt)) : undefined;
      if (point) point.sent += 1;
    }
    for (const event of home.recent) {
      const point = byWeek.get(isoWeek(event.at));
      if (!point) continue;
      if (REPLY_EVENTS.has(event.kind)) point.replies += 1;
      if (event.kind === 'interview_invite') point.interviews += 1;
    }
  } else {
    for (const row of funnel) {
      const point = byWeek.get(row.week);
      if (!point) continue;
      point.sent = row.sent;
      point.replies = row.replies;
      point.interviews = row.interviews;
    }
  }
  const points = [...byWeek.values()];
  return { points, partial, empty: points.every((point) => point.sent + point.replies + point.interviews === 0) };
}

// ─── Weekly goal ─────────────────────────────────────────────────────────

/** What's left of the week's goal and the pace that would land it (Monday to Sunday, India time). */
export function weekPace(week: CareerHome['week'], now: Date = new Date()): { left: number; daysLeft: number; perDay: number; done: boolean } {
  const local = new Date(now.getTime() + IST_OFFSET_MS);
  const weekday = local.getUTCDay() || 7;
  const daysLeft = 8 - weekday;
  const left = Math.max(0, week.goal - week.sent);
  return { left, daysLeft, perDay: left === 0 ? 0 : Math.ceil(left / daysLeft), done: left === 0 };
}

// ─── Notifications ───────────────────────────────────────────────────────

export type PanelHeadsup = { id: string; kind: 'interview' | 'offer' | 'question' | 'follow_up'; title: string; detail: string; jobId: string; urgent: boolean };

/**
 * What would raise a Career heads-up right now (lib/career/notify.ts's four
 * kinds), worked out from the home: an interview within two days, an offer
 * waiting, a recruiter's question from the last week, and a follow-up due.
 */
export function panelHeadsups(home: CareerHome, now: Date = new Date()): PanelHeadsup[] {
  const cards = allApplications(home);
  const byApp = new Map(cards.map((card) => [card.application.id, card]));
  const out: PanelHeadsup[] = [];
  for (const item of home.upcoming) {
    if (!item.at) continue;
    const gap = Date.parse(item.at) - now.getTime();
    if (gap < 0 || gap > 2 * DAY_MS) continue;
    out.push({ id: `interview-${item.application.id}`, kind: 'interview', title: `Interview with ${item.job.company}`, detail: dayTime(item.at), jobId: item.job.id, urgent: gap < DAY_MS });
  }
  for (const card of cards) {
    if (card.application.status !== 'offer') continue;
    out.push({ id: `offer-${card.application.id}`, kind: 'offer', title: `Offer from ${card.job.company}`, detail: 'Confirm the terms, then get advice', jobId: card.job.id, urgent: true });
  }
  for (const event of home.recent) {
    if (event.kind !== 'recruiter_question' || !event.applicationId) continue;
    if (now.getTime() - Date.parse(event.at) > 7 * DAY_MS) continue;
    const card = byApp.get(event.applicationId);
    if (!card) continue;
    out.push({ id: `question-${event.id}`, kind: 'question', title: `${card.job.company} asked a question`, detail: event.summary, jobId: card.job.id, urgent: true });
  }
  for (const card of home.followUps) {
    out.push({ id: `follow-${card.application.id}`, kind: 'follow_up', title: `Follow up with ${card.job.company}`, detail: card.job.title, jobId: card.job.id, urgent: false });
  }
  return out;
}

// ─── Today ───────────────────────────────────────────────────────────────

export type AgendaItem = { id: string; kind: 'interview' | 'follow_up'; title: string; detail: string; at: string | null; jobId: string };

/** Today's interviews and due follow-ups (the checklist), and the interviews after today. */
export function todayAgenda(home: CareerHome, now: Date = new Date()): { today: AgendaItem[]; comingUp: AgendaItem[] } {
  const today: AgendaItem[] = [];
  const comingUp: AgendaItem[] = [];
  const day = istDay(now);
  const sorted = [...home.upcoming].sort((left, right) => (left.at ?? '9').localeCompare(right.at ?? '9'));
  for (const item of sorted) {
    const entry: AgendaItem = { id: `interview-${item.application.id}`, kind: 'interview', title: `Interview: ${item.job.company}`, detail: [item.job.title, item.format].filter(Boolean).join(', '), at: item.at, jobId: item.job.id };
    if (item.at && istDay(item.at) === day) today.push(entry);
    else if (!item.at || Date.parse(item.at) > now.getTime()) comingUp.push(entry);
  }
  for (const card of home.followUps) {
    today.push({ id: `follow-${card.application.id}`, kind: 'follow_up', title: `Follow up: ${card.job.company}`, detail: card.job.title, at: null, jobId: card.job.id });
  }
  return { today, comingUp: comingUp.slice(0, 4) };
}

// ─── Search ──────────────────────────────────────────────────────────────

export type PaletteItem =
  | { kind: 'page'; id: string; label: string; detail: string; page: PanelPage }
  | { kind: 'job'; id: string; label: string; detail: string; jobId: string }
  | { kind: 'application'; id: string; label: string; detail: string; jobId: string }
  | { kind: 'company'; id: string; label: string; detail: string; company: string };

/** Everything the command palette can find in the loaded data: pages, applications, jobs and companies. */
export function paletteIndex(home: CareerHome | null, jobs: readonly CareerJob[]): PaletteItem[] {
  const pages: PaletteItem[] = PANEL_PAGES.map((page) => ({ kind: 'page', id: `page-${page}`, label: PAGE_META[page].label, detail: 'Go to page', page }));
  if (!home) return pages;
  const cards = allApplications(home);
  const applied = new Set(cards.map((card) => card.job.id));
  const applications: PaletteItem[] = cards.map((card) => ({ kind: 'application', id: `app-${card.application.id}`, label: card.job.title, detail: `${card.job.company}, ${STAGE_LABEL[groupOf(card.application.status)]}`, jobId: card.job.id }));
  const jobMap = new Map<string, CareerJob>();
  for (const job of [...home.hotMatches, ...jobs]) if (!applied.has(job.id)) jobMap.set(job.id, job);
  const jobItems: PaletteItem[] = [...jobMap.values()].map((job) => ({ kind: 'job', id: `job-${job.id}`, label: job.title, detail: job.score === null ? job.company : `${job.company}, match ${job.score}`, jobId: job.id }));
  const companies = new Map<string, number>();
  for (const name of [...cards.map((card) => card.job.company), ...[...jobMap.values()].map((job) => job.company)]) companies.set(name, (companies.get(name) ?? 0) + 1);
  const companyItems: PaletteItem[] = [...companies].map(([company, count]) => ({ kind: 'company', id: `company-${company}`, label: company, detail: count === 1 ? '1 job or application' : `${count} jobs and applications`, company }));
  return [...pages, ...applications, ...jobItems, ...companyItems];
}

/** Items whose label or detail holds every word of `query`, best first: label starts, then label contains. */
export function searchPalette(items: readonly PaletteItem[], query: string, limit = 12): PaletteItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items.filter((item) => item.kind === 'page' || item.kind === 'application').slice(0, limit);
  const scored = items.flatMap((item) => {
    const label = item.label.toLowerCase();
    const text = `${label} ${item.detail.toLowerCase()}`;
    if (!words.every((word) => text.includes(word))) return [];
    let rank = 2;
    if (label.startsWith(words[0])) rank = 0;
    else if (label.includes(words[0])) rank = 1;
    return [{ item, rank }];
  });
  return scored.sort((left, right) => left.rank - right.rank).slice(0, limit).map((entry) => entry.item);
}

export const STAGE_LABEL: Record<StageGroupId, string> = { ready: 'Ready', sent: 'Sent', replied: 'Replied', interview: 'Interview', offer: 'Offer', closed: 'Closed' };

// ─── Money and percentages ───────────────────────────────────────────────

export const percent = (value: number) => `${Math.round(value * 100)}%`;

/** "+3 on last week", "2 fewer than last week", "Same as last week". */
export function weekDelta(now: number, before: number): { text: string; tone: 'up' | 'down' | 'flat' } {
  if (now === before) return { text: 'Same as last week', tone: 'flat' };
  if (now > before) return { text: `+${now - before} on last week`, tone: 'up' };
  return { text: `${before - now} fewer than last week`, tone: 'down' };
}
