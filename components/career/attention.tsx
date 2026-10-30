'use client';

import { useState, type ReactNode } from 'react';
import { CalendarClock, ChevronRight, HandCoins, Inbox, MessageCircleQuestion, MessageSquareReply, Reply, Send } from 'lucide-react';
import { dayMonth, dayTime } from '@/components/career/format';
import { allApplications, istDay, relativeTime } from '@/components/career/panel/panel-data';
import { STAGE_GROUPS, type StageGroupId } from '@/lib/career/status';
import type { ApplicationCard, CareerHome } from '@/lib/career/view';

/**
 * What needs the owner now, shared by the tab's Today and the panel's Home.
 * Each item says what happened, what to do next, and when, in that order, so
 * a glance answers "is anything waiting on me?" without opening a list.
 */
export type AttentionKind = 'offer' | 'interview' | 'question' | 'reply' | 'ready' | 'follow_up' | 'unmatched';

export type Attention = {
  id: string;
  kind: AttentionKind;
  /** What happened, in a few words. */
  title: string;
  /** What to do next, calmly. */
  next: string;
  /** When: a time, a date or how long ago. */
  when: string | null;
  jobId: string | null;
  /** Today's interviews and due follow-ups can be ticked off (kept in this browser). */
  tickable: boolean;
};

const DAY_MS = 86_400_000;
const REPLY_STATES = new Set(['replied', 'assessment']);

/** Every item that needs the owner, the most pressing first. */
export function attentionItems(home: CareerHome, now: Date = new Date()): Attention[] {
  const cards = allApplications(home);
  const byApp = new Map(cards.map((card) => [card.application.id, card]));
  const lastEvent = new Map<string, string>();
  for (const event of home.recent) if (event.applicationId && !lastEvent.has(event.applicationId)) lastEvent.set(event.applicationId, event.at);
  const ago = (card: ApplicationCard) => {
    const at = lastEvent.get(card.application.id) ?? card.application.lastEventAt;
    return at ? relativeTime(at, now) : null;
  };
  const today = istDay(now);
  const out: Attention[] = [];

  for (const card of cards) {
    if (card.application.status !== 'offer') continue;
    out.push({ id: `offer-${card.application.id}`, kind: 'offer', title: `${card.job.company} made an offer`, next: 'Confirm the terms, then get advice before you answer.', when: ago(card), jobId: card.job.id, tickable: false });
  }

  const interviews = [...home.upcoming]
    .filter((item) => !item.at || Date.parse(item.at) > now.getTime() - 2 * 3_600_000)
    .sort((left, right) => (left.at ?? '9').localeCompare(right.at ?? '9'));
  const soon = interviews.filter((item) => item.at && Date.parse(item.at) - now.getTime() < 2 * DAY_MS);
  const later = interviews.filter((item) => !soon.includes(item));
  const interviewItem = (item: (typeof interviews)[number]): Attention => ({
    id: `interview-${item.application.id}`,
    kind: 'interview',
    title: `Interview with ${item.job.company}`,
    next: item.application.prep ? 'Your prep pack is ready. Read it the day before.' : 'Open it to see the details and prepare.',
    when: item.at ? dayTime(item.at) : 'Time not confirmed yet',
    jobId: item.job.id,
    tickable: Boolean(item.at && istDay(item.at) === today),
  });
  out.push(...soon.map(interviewItem));

  const asked = new Set<string>();
  for (const event of home.recent) {
    if (event.kind !== 'recruiter_question' || !event.applicationId) continue;
    if (now.getTime() - Date.parse(event.at) > 7 * DAY_MS) continue;
    const card = byApp.get(event.applicationId);
    if (!card || asked.has(card.application.id)) continue;
    asked.add(card.application.id);
    out.push({ id: `question-${event.id}`, kind: 'question', title: `${card.job.company} asked you a question`, next: event.summary || 'Read it and answer when you can.', when: relativeTime(event.at, now), jobId: card.job.id, tickable: false });
  }

  for (const card of cards) {
    if (!REPLY_STATES.has(card.application.status) || asked.has(card.application.id)) continue;
    const assessment = card.application.status === 'assessment';
    out.push({
      id: `reply-${card.application.id}`,
      kind: 'reply',
      title: assessment ? `${card.job.company} sent an assessment` : `${card.job.company} wrote back`,
      next: assessment ? 'Complete it, then mark it done in the application.' : 'Read their reply and answer it.',
      when: ago(card),
      jobId: card.job.id,
      tickable: false,
    });
  }

  for (const card of home.queue) {
    out.push({ id: `ready-${card.application.id}`, kind: 'ready', title: `Your application to ${card.job.company} is ready`, next: `${card.job.title}. Review it, then press Send.`, when: card.job.score === null ? null : `Match ${card.job.score}`, jobId: card.job.id, tickable: false });
  }

  for (const card of home.followUps) {
    const sent = card.application.sentAt ?? card.application.updatedAt;
    out.push({
      id: `follow-${card.application.id}`,
      kind: 'follow_up',
      title: `Time to follow up with ${card.job.company}`,
      next: card.application.followUpDraft ? 'A short follow-up is drafted. Review and send it.' : `No reply since ${dayMonth(sent)}. That's normal; a short nudge often helps.`,
      when: 'Due today',
      jobId: card.job.id,
      tickable: true,
    });
  }

  out.push(...later.map(interviewItem));

  if (home.unmatched.length > 0) {
    const count = home.unmatched.length;
    out.push({ id: 'unmatched', kind: 'unmatched', title: count === 1 ? 'A reply needs matching' : `${count} replies need matching`, next: 'Orbis found them in Gmail but couldn’t tell which application they answer.', when: null, jobId: null, tickable: false });
  }
  return out;
}

/** "3 things need you", or the all-clear. */
export function attentionLead(count: number): string {
  if (count === 0) return 'You’re all caught up';
  return count === 1 ? '1 thing needs you' : `${count} things need you`;
}

const KIND_ICON: Record<AttentionKind, typeof Send> = {
  offer: HandCoins,
  interview: CalendarClock,
  question: MessageCircleQuestion,
  reply: MessageSquareReply,
  ready: Send,
  follow_up: Reply,
  unmatched: Inbox,
};

/** Today's ticks: the owner's own notes for the day, kept in this browser only. */
export function useDayTicks(now: Date = new Date()) {
  const key = `orbis-career-today-${istDay(now)}`;
  const [ticks, setTicks] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  const toggle = (id: string) => setTicks((current) => {
    const next = current.includes(id) ? current.filter((tick) => tick !== id) : [...current, id];
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Storage blocked: the tick lasts until the page closes.
    }
    return next;
  });
  return { ticks, toggle };
}

/**
 * The attention list: one row per item, each opening its application. Rows
 * for today can be ticked off. `onUnmatched` handles the "needs matching" row.
 */
export function AttentionList({ items, onOpen, onUnmatched, empty }: Readonly<{
  items: Attention[];
  onOpen: (jobId: string) => void;
  onUnmatched?: () => void;
  empty: ReactNode;
}>) {
  const { ticks, toggle } = useDayTicks();
  const shown = items.filter((item) => item.kind !== 'unmatched' || onUnmatched);
  if (shown.length === 0) return <div className="cr-att-empty">{empty}</div>;
  return (
    <ol className="cr-att">
      {shown.map((item) => {
        const Icon = KIND_ICON[item.kind];
        const done = item.tickable && ticks.includes(item.id);
        const open = item.jobId ? () => onOpen(item.jobId as string) : onUnmatched;
        return (
          <li key={item.id} className={`cr-att-row k-${item.kind}${done ? ' done' : ''}`}>
            {item.tickable ? (
              <label className="cr-att-tick">
                <input type="checkbox" checked={done} onChange={() => toggle(item.id)} />
                <span className="sr-only">Done: {item.title}</span>
              </label>
            ) : (
              <span className="cr-att-icon" aria-hidden="true"><Icon size={16} strokeWidth={2.1} /></span>
            )}
            <button type="button" className="cr-att-main" onClick={open}>
              <span className="cr-att-text">
                <b>{item.title}</b>
                <span>{item.next}</span>
              </span>
              {item.when && <small className="cr-att-when">{item.when}</small>}
              <ChevronRight className="cr-att-go" size={16} aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ol>
  );
}

const STRIP_IDS: readonly StageGroupId[] = ['ready', 'sent', 'replied', 'interview', 'offer'];

/**
 * The signature: the pipeline as one line of stages, Ready to Offer, each with
 * its count set big on a thread, and the closed ones quietly at the end.
 * A stage is a button when `onPick` is given (to filter or jump to it).
 */
export function StageStrip({ cards, onPick, active = null, label = 'Your applications by stage' }: Readonly<{
  cards: readonly ApplicationCard[];
  onPick?: (stage: StageGroupId) => void;
  active?: StageGroupId | null;
  label?: string;
}>) {
  const count = (id: StageGroupId) => {
    const group = STAGE_GROUPS.find((item) => item.id === id);
    return group ? cards.filter((card) => group.statuses.includes(card.application.status)).length : 0;
  };
  const closed = count('closed');
  return (
    <div className="cr-pipe-wrap">
      <ol className="cr-pipe" aria-label={label}>
        {STRIP_IDS.map((id) => {
          const group = STAGE_GROUPS.find((item) => item.id === id);
          const n = count(id);
          const body = (
            <>
              <b>{n}</b>
              <span><i aria-hidden="true" />{group?.label}</span>
            </>
          );
          return (
            <li key={id} className={`cr-pipe-stage cr-stage-${id}${n === 0 ? ' none' : ''}`}>
              {onPick ? (
                <button type="button" onClick={() => onPick(id)} aria-pressed={active === id}>{body}</button>
              ) : <div>{body}</div>}
            </li>
          );
        })}
      </ol>
      {closed > 0 && (
        onPick ? (
          <button type="button" className="cr-pipe-closed" onClick={() => onPick('closed')} aria-pressed={active === 'closed'}>{closed} closed</button>
        ) : <p className="cr-pipe-closed">{closed} closed</p>
      )}
    </div>
  );
}
