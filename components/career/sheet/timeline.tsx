'use client';

import { useId, useState } from 'react';
import { Send } from 'lucide-react';
import { sendFollowUpAction } from '@/app/career/actions';
import { BusyIcon, NoticeLine } from '@/components/career/bits';
import { dayMonth, dayTime } from '@/components/career/format';
import { useRun } from '@/components/career/use-run';
import { fallbackFollowUp, isFollowUpDue } from '@/lib/career/followup';
import type { CareerApplication, CareerEvent, CareerJob, EventKind } from '@/lib/career/types';
import type { ApplicationDetail } from '@/lib/career/view';

export const EVENT_LABEL: Record<EventKind, string> = {
  sent: 'Sent',
  acknowledgement: 'Acknowledged',
  reply: 'Reply',
  recruiter_question: 'Recruiter question',
  assessment: 'Assessment',
  interview_invite: 'Interview invite',
  rejection: 'Rejection',
  offer: 'Offer',
  follow_up_sent: 'Follow-up sent',
  status_change: 'Status changed',
  note: 'Note',
};

/** Every event on the application, newest first. */
export function Timeline({ events }: Readonly<{ events: CareerEvent[] }>) {
  const sorted = [...events].sort((left, right) => right.at.localeCompare(left.at));
  return (
    <section className="cr-block" aria-labelledby="cr-timeline-title">
      <h2 className="fd-label" id="cr-timeline-title">Timeline</h2>
      {sorted.length === 0 ? <p className="cr-block-note">Nothing yet. Replies Orbis finds in your Gmail land here.</p> : (
        <ol className="cr-timeline">
          {sorted.map((event) => (
            <li key={event.id} className={`cr-ev-${event.kind}`}>
              <i aria-hidden="true" />
              <div>
                <p><b>{EVENT_LABEL[event.kind]}</b><time dateTime={event.at}>{dayTime(event.at)}</time></p>
                {event.summary && <span>{event.summary}</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** A follow-up the server drafted, if it left one on an event; otherwise Orbis's plain fallback. */
function startingText(events: CareerEvent[], application: CareerApplication, job: CareerJob, name: string) {
  const drafted = [...events].reverse().map((event) => event.details.followUpDraft).find((text): text is string => typeof text === 'string');
  if (drafted) return drafted;
  return fallbackFollowUp({ name, job: { title: job.title, company: job.company }, sentAt: application.sentAt ?? application.updatedAt });
}

/** The follow-up, on the day it's due: editable, and sent only by its own Send. */
export function FollowUp({ application, job, events, name, onDetail }: Readonly<{ application: CareerApplication; job: CareerJob; events: CareerEvent[]; name: string; onDetail: (detail: ApplicationDetail) => void }>) {
  const id = useId();
  const [text, setText] = useState(() => startingText(events, application, job, name));
  const { busy, notice, run } = useRun();
  const today = new Date().toISOString().slice(0, 10);
  if (!application.followUpDue) return null;
  if (!isFollowUpDue(application, today)) {
    if (application.status !== 'sent' && application.status !== 'acknowledged') return null;
    return <p className="cr-followup-later">Follow-up due {dayMonth(application.followUpDue)} if they haven’t replied by then.</p>;
  }
  const send = () => run('follow', () => sendFollowUpAction(application.id, text.trim()), (detail) => {
    onDetail(detail);
    return 'Follow-up sent in the same thread.';
  });
  return (
    <section className="cr-block cr-followup" aria-labelledby="cr-follow-title">
      <h2 className="fd-label" id="cr-follow-title">Follow-up due</h2>
      <p className="cr-block-note">No reply since {dayMonth(application.sentAt ?? application.updatedAt)}. This goes in the same Gmail thread, only when you press Send.</p>
      <label className="fd-field" htmlFor={id}>
        <span className="sr-only">Follow-up message</span>
        <textarea id={id} rows={7} value={text} onChange={(event) => setText(event.currentTarget.value)} />
      </label>
      <div className="fd-act pf-act">
        <button type="button" onClick={send} disabled={busy !== null || text.trim().length < 20}>
          <BusyIcon on={busy === 'follow'}><Send size={14} aria-hidden="true" /></BusyIcon>
          Send follow-up
        </button>
      </div>
      <NoticeLine notice={notice} />
    </section>
  );
}
