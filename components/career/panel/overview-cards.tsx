'use client';

import { CalendarClock, CircleCheck, HandCoins, MessageSquareReply, Send, StickyNote, XCircle } from 'lucide-react';
import { countRange } from '@/components/career/format';
import { EVENT_LABEL } from '@/components/career/sheet/timeline';
import { PanelCard } from '@/components/career/panel/panel-bits';
import { usePanel } from '@/components/career/panel/panel-context';
import { allApplications, openCount, relativeTime } from '@/components/career/panel/panel-data';
import type { EventKind } from '@/lib/career/types';
import type { CareerHome } from '@/lib/career/view';

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
