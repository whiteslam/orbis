'use client';

import { useState } from 'react';
import { ArrowUpRight, CalendarClock, CircleCheck, HandCoins, MessageSquareReply, Reply, Send, StickyNote, XCircle } from 'lucide-react';
import { countRange, creditFor, dayTime, freshness, salaryText, scoreBand } from '@/components/career/format';
import { EVENT_LABEL } from '@/components/career/sheet/timeline';
import { PanelCard } from '@/components/career/panel/panel-bits';
import { usePanel } from '@/components/career/panel/panel-context';
import { allApplications, hrefFor, istDay, openCount, percent, relativeTime, stageMix, todayAgenda, weekPace, type AgendaItem } from '@/components/career/panel/panel-data';
import type { CareerJob, EventKind } from '@/lib/career/types';
import type { CareerHome } from '@/lib/career/view';

// ─── Hot matches ─────────────────────────────────────────────────────────

/** A match as a bold card in its stage's colour: Found (gold), or Ready (blue) once its draft waits for Send. */
function HotCard({ job, drafted, onOpen }: Readonly<{ job: CareerJob; drafted: boolean; onOpen: () => void }>) {
  const salary = salaryText(job.salary ?? job.requirements?.salary ?? null);
  const fresh = freshness(job);
  const { word } = scoreBand(job.score);
  const stage = drafted ? 'Draft ready' : 'New match';
  return (
    <li>
      <button type="button" className={`cp-hot cp-fill-${drafted ? 'ready' : 'found'}`} onClick={onOpen} aria-label={`${job.title} at ${job.company}. ${stage}, match ${job.score ?? 'not scored'}, ${word.toLowerCase()}. ${salary ?? 'Salary not stated'}. ${fresh.text}.`}>
        <span className="cp-hot-top">
          <span className="cp-hot-stage">{stage}</span>
          <span className="cp-hot-score"><b>{job.score ?? '–'}</b></span>
        </span>
        <span className="cp-hot-title">{job.title}</span>
        <span className="cp-hot-company">{job.company}</span>
        <span className="cp-hot-foot">
          <b>{salary ?? 'Salary not stated'}</b>
          <small>{fresh.text}, {creditFor(job).replace(/^via /, '')}</small>
        </span>
      </button>
    </li>
  );
}

export function HotMatches({ home }: Readonly<{ home: CareerHome }>) {
  const { openJob } = usePanel();
  const drafted = new Set(home.queue.map((card) => card.job.id));
  const jobs = home.hotMatches.slice(0, 6);
  return (
    <PanelCard title="Hot matches" className="cp-a-hot" aside={<a className="cp-link" href={hrefFor('jobs')}>All jobs<ArrowUpRight size={14} aria-hidden="true" /></a>}>
      {jobs.length === 0 ? (
        <p className="cp-quiet">No new matches above your bar right now. Orbis searches every few hours; run a search from the rail to look now.</p>
      ) : (
        <ul className="cp-hot-grid">
          {jobs.map((job) => <HotCard key={job.id} job={job} drafted={drafted.has(job.id)} onOpen={() => openJob(job)} />)}
        </ul>
      )}
    </PanelCard>
  );
}

// ─── Weekly goal ─────────────────────────────────────────────────────────

const RING = 128;
const RING_STROKE = 11;

export function WeeklyGoal({ home }: Readonly<{ home: CareerHome }>) {
  const { week } = home;
  const pace = weekPace(week);
  const share = Math.min(1, week.sent / Math.max(1, week.goal));
  const radius = (RING - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  let paceLine = `Send ${pace.perDay} a day to land it by Sunday.`;
  if (pace.done) paceLine = 'Goal met for this week. Anything more is a bonus.';
  else if (pace.daysLeft === 1) paceLine = `${pace.left} to go today to land it.`;
  return (
    <PanelCard title="Weekly goal" className="cp-a-goal" aside={<a className="cp-link" href={hrefFor('setup')}>Change</a>}>
      <div className="cp-goal">
        <span className="cp-goal-ring" role="img" aria-label={`${week.sent} of ${week.goal} applications sent this week`}>
          <svg width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`} aria-hidden="true">
            <defs>
              <linearGradient id="cp-goal-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="var(--brand-blue)" />
                <stop offset="100%" stopColor="var(--brand-teal)" />
              </linearGradient>
            </defs>
            <circle cx={RING / 2} cy={RING / 2} r={radius} fill="none" stroke="var(--fd-ring-track)" strokeWidth={RING_STROKE} />
            {share > 0 && (
              <circle cx={RING / 2} cy={RING / 2} r={radius} fill="none" stroke="url(#cp-goal-grad)" strokeWidth={RING_STROKE} strokeLinecap="round"
                strokeDasharray={`${share * circumference} ${circumference}`} transform={`rotate(-90 ${RING / 2} ${RING / 2})`} />
            )}
          </svg>
          <span className="cp-goal-mid" aria-hidden="true"><b>{week.sent}</b><small>of {week.goal}</small></span>
        </span>
        <dl className="cp-goal-stats">
          <div><dt>Sent</dt><dd>{week.sent}</dd></div>
          <div><dt>Left</dt><dd>{pace.left}</dd></div>
          <div><dt>Days left</dt><dd>{pace.daysLeft}</dd></div>
        </dl>
      </div>
      <p className="cp-goal-pace">{paceLine}</p>
    </PanelCard>
  );
}

// ─── Stage mix ───────────────────────────────────────────────────────────

export function StageMix({ home }: Readonly<{ home: CareerHome }>) {
  const cards = allApplications(home);
  const mix = stageMix(cards);
  const open = openCount(cards);
  return (
    <PanelCard title="Stage mix" className="cp-a-mix" aside={<a className="cp-link" href={hrefFor('pipeline')}>Pipeline<ArrowUpRight size={14} aria-hidden="true" /></a>}>
      <p className="cp-hero-line"><b>{open}</b><span>in play, of {cards.length} {cards.length === 1 ? 'application' : 'applications'}</span></p>
      {cards.length > 0 && (
        <div className="cp-mixbar" aria-hidden="true">
          {mix.filter((stage) => stage.count > 0).map((stage) => (
            <span key={stage.id} className={`cp-seg cp-fill-${stage.id}`} style={{ flexGrow: stage.count }} />
          ))}
        </div>
      )}
      <table className="cp-mix-table">
        <caption className="sr-only">Applications per stage</caption>
        <thead className="sr-only"><tr><th scope="col">Stage</th><th scope="col">Applications</th><th scope="col">Share</th></tr></thead>
        <tbody>
          {mix.map((stage) => (
            <tr key={stage.id}>
              <th scope="row"><span className="cp-mix-name"><i className={`cp-dot cp-fill-${stage.id}`} aria-hidden="true" />{stage.label}</span></th>
              <td>{stage.count}</td>
              <td>{cards.length ? percent(stage.share) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </PanelCard>
  );
}

// ─── Predictions ─────────────────────────────────────────────────────────

function RangeRow({ label, range, top }: Readonly<{ label: string; range: [number, number]; top: number }>) {
  const left = (Math.max(0, range[0]) / top) * 100;
  const width = Math.max(2, ((range[1] - range[0]) / top) * 100);
  return (
    <div className="cp-range">
      <p><b>{countRange(range)}</b><span>{label}</span></p>
      <div className="cp-range-track" aria-hidden="true"><i style={{ left: `${left}%`, width: `${width}%` }} /></div>
    </div>
  );
}

export function Predictions({ home }: Readonly<{ home: CareerHome }>) {
  const forecast = home.insights?.forecast ?? null;
  const open = openCount(allApplications(home));
  const top = forecast ? Math.max(1, Math.ceil(Math.max(forecast.replies[1], forecast.interviews[1]) * 1.15)) : 1;
  return (
    <PanelCard title="Next 14 days" className="cp-a-pred" aside={forecast && <span className="cp-tag">{forecast.early ? 'Early estimate' : 'From your outcomes'}</span>}>
      {forecast ? (
        <>
          <RangeRow label="replies likely" range={forecast.replies} top={top} />
          <RangeRow label="interviews likely" range={forecast.interviews} top={top} />
          <p className="cp-foot-note">
            From {open} open {open === 1 ? 'application' : 'applications'}{forecast.early ? ' and a starting model. The ranges narrow as replies come in.' : ' and how quickly companies have answered you.'}
          </p>
        </>
      ) : (
        <p className="cp-quiet">A forecast appears once a few applications are out. It gives replies and interviews as ranges, never a single guess.</p>
      )}
    </PanelCard>
  );
}

// ─── Today ───────────────────────────────────────────────────────────────

/** Ticks are the owner's own notes for the day, kept in this browser only. */
function useDayTicks(day: string) {
  const key = `orbis-career-today-${day}`;
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

function TodayRow({ item, done, onToggle, onOpen }: Readonly<{ item: AgendaItem; done: boolean; onToggle: () => void; onOpen: () => void }>) {
  const Icon = item.kind === 'interview' ? CalendarClock : Reply;
  return (
    <li className={done ? 'done' : undefined}>
      <input type="checkbox" checked={done} onChange={onToggle} aria-label={`Done: ${item.title}`} />
      <button type="button" className="cp-today-main" onClick={onOpen}>
        <b>{item.title}</b>
        <small>{item.at ? `${dayTime(item.at)}, ${item.detail}` : item.detail}</small>
      </button>
      <span className={`cp-today-kind k-${item.kind}`} aria-hidden="true"><Icon size={14} /></span>
    </li>
  );
}

function DateBlock({ at }: Readonly<{ at: string | null }>) {
  if (!at) return <span className="cp-dateblock"><b>TBC</b></span>;
  const date = new Date(at);
  const weekday = date.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' });
  const day = date.toLocaleDateString('en-IN', { day: 'numeric', timeZone: 'Asia/Kolkata' });
  return <span className="cp-dateblock"><small>{weekday}</small><b>{day}</b></span>;
}

export function TodayCard({ home }: Readonly<{ home: CareerHome }>) {
  const { openJobId } = usePanel();
  const { today, comingUp } = todayAgenda(home);
  const { ticks, toggle } = useDayTicks(istDay(new Date()));
  const done = today.filter((item) => ticks.includes(item.id)).length;
  return (
    <PanelCard title="Today" className="cp-a-today" aside={<a className="cp-link" href={hrefFor('interviews')}>Agenda<ArrowUpRight size={14} aria-hidden="true" /></a>}>
      {today.length > 0 && (
        <div className="cp-progress">
          <span>{done} of {today.length} done</span>
          <div className="cr-meter" aria-hidden="true"><i style={{ width: `${(done / today.length) * 100}%` }} /></div>
        </div>
      )}
      {today.length === 0 ? <p className="cp-quiet">No interviews or follow-ups today.</p> : (
        <ul className="cp-today">
          {today.map((item) => <TodayRow key={item.id} item={item} done={ticks.includes(item.id)} onToggle={() => toggle(item.id)} onOpen={() => openJobId(item.jobId)} />)}
        </ul>
      )}
      <h3 className="cp-sub">Coming up</h3>
      {comingUp.length === 0 ? <p className="cp-quiet">Nothing booked after today.</p> : (
        <ul className="cp-soon">
          {comingUp.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => openJobId(item.jobId)}>
                <DateBlock at={item.at} />
                <span><b>{item.title}</b><small>{item.at ? dayTime(item.at) : 'Time not given yet'}{item.detail ? `, ${item.detail}` : ''}</small></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </PanelCard>
  );
}

// ─── Recent activity ─────────────────────────────────────────────────────

const EVENT_ICON: Partial<Record<EventKind, typeof Send>> = {
  sent: Send,
  follow_up_sent: Send,
  reply: MessageSquareReply,
  recruiter_question: MessageSquareReply,
  acknowledgement: CircleCheck,
  assessment: StickyNote,
  interview_invite: CalendarClock,
  offer: HandCoins,
  rejection: XCircle,
};

export function RecentActivity({ home }: Readonly<{ home: CareerHome }>) {
  const { openJobId } = usePanel();
  const jobByApp = new Map(allApplications(home).map((card) => [card.application.id, card.job.id]));
  const events = home.recent.slice(0, 5);
  return (
    <PanelCard title="Recent activity" className="cp-a-recent">
      {events.length === 0 ? <p className="cp-quiet">Sends, replies and interviews show here as they happen.</p> : (
        <ul className="cp-activity">
          {events.map((event) => {
            const Icon = EVENT_ICON[event.kind] ?? StickyNote;
            const jobId = event.applicationId ? jobByApp.get(event.applicationId) : undefined;
            const body = (
              <>
                <span className={`cp-act-icon cr-ev-${event.kind}`} aria-hidden="true"><Icon size={14} /></span>
                <span className="cp-act-text">
                  <b>{EVENT_LABEL[event.kind]}{event.company ? `: ${event.company}` : ''}</b>
                  {event.title && <small>{event.title}</small>}
                  {event.summary && <span>{event.summary}</span>}
                  <time dateTime={event.at}>{relativeTime(event.at)}</time>
                </span>
              </>
            );
            return <li key={event.id}>{jobId ? <button type="button" onClick={() => openJobId(jobId)}>{body}</button> : <div>{body}</div>}</li>;
          })}
        </ul>
      )}
    </PanelCard>
  );
}
