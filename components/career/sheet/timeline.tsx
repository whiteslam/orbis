'use client';

import { useId, useState } from 'react';
import { Send } from 'lucide-react';
import { sendFollowUpAction } from '@/app/career/actions';
import { BusyIcon, CopyButton, NoticeLine } from '@/components/career/bits';
import { dayMonth, dayTime } from '@/components/career/format';
import { useRun } from '@/components/career/use-run';
import { fallbackFollowUp, isFollowUpDue } from '@/lib/career/followup';
import type { ApplicationStatus, CareerApplication, CareerEvent, CareerJob, EventKind } from '@/lib/career/types';
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

// Where sendFollowUpAction will send from (lib/career/send.ts FOLLOW_UP_FROM).
const FOLLOW_UP_FROM: readonly ApplicationStatus[] = ['sent', 'acknowledged', 'ghosted'];
const AWAITING: readonly ApplicationStatus[] = ['sent', 'acknowledged'];

/**
 * The follow-up to start from: the one Orbis drafted (the watcher stores it on
 * the application when the day comes), an older draft left on an event, or
 * Orbis's plain fallback when the day has come before the watcher has run.
 */
function startingText(events: CareerEvent[], application: CareerApplication, job: CareerJob, name: string) {
  if (application.followUpDraft?.trim()) return application.followUpDraft;
  const drafted = [...events].reverse().map((event) => event.details.followUpDraft).find((text): text is string => typeof text === 'string' && text.trim() !== '');
  if (drafted) return drafted;
  return fallbackFollowUp({ name, job: { title: job.title, company: job.company }, sentAt: application.sentAt ?? application.updatedAt });
}

/** What the follow-up block shows: the editor, the day it's due, or nothing. */
function followUpState(application: CareerApplication, today: string): 'edit' | 'later' | null {
  if (!FOLLOW_UP_FROM.includes(application.status)) return null;
  if (application.followUpDraft?.trim()) return 'edit';
  if (!application.followUpDue) return null;
  if (isFollowUpDue(application, today)) return 'edit';
  return AWAITING.includes(application.status) ? 'later' : null;
}

/**
 * The follow-up Orbis drafted (or the plain one, on the day it's due):
 * editable, and sent only by its own Send. It goes as a reply in the Gmail
 * thread the application went out in; one that went through Recruitee has no
 * thread, so it is offered to copy instead.
 */
export function FollowUp({ application, job, events, name, onDetail }: Readonly<{ application: CareerApplication; job: CareerJob; events: CareerEvent[]; name: string; onDetail: (detail: ApplicationDetail) => void }>) {
  const id = useId();
  const [text, setText] = useState(() => startingText(events, application, job, name));
  const { busy, notice, run } = useRun();
  const today = new Date().toISOString().slice(0, 10);
  const state = followUpState(application, today);
  // Sending clears the draft; the confirmation stays where the editor was.
  if (state === null) return notice?.ok ? <div className="cr-block"><NoticeLine notice={notice} /></div> : null;
  if (state === 'later' && application.followUpDue) {
    return <p className="cr-followup-later">Follow-up due {dayMonth(application.followUpDue)} if they haven’t replied by then.</p>;
  }
  const drafted = Boolean(application.followUpDraft?.trim());
  const threaded = Boolean(application.gmailThreadId);
  const send = () => run('follow', () => sendFollowUpAction(application.id, text.trim()), (detail) => {
    onDetail(detail);
    return 'Follow-up sent in the same thread.';
  });
  let note = `No reply since ${dayMonth(application.sentAt ?? application.updatedAt)}.`;
  note += drafted ? ' Orbis drafted this follow-up; change anything you like.' : '';
  note += threaded
    ? ' It goes in the same Gmail thread, only when you press Send.'
    : ' This one went out through their careers page, so there’s no Gmail thread to reply in. Copy it and send it from your own mail.';
  return (
    <section className="cr-block cr-followup" aria-labelledby="cr-follow-title">
      <h2 className="fd-label" id="cr-follow-title">{drafted ? 'Follow-up drafted' : 'Follow-up due'}</h2>
      <p className="cr-block-note">{note}</p>
      <label className="fd-field" htmlFor={id}>
        <span className="sr-only">Follow-up message</span>
        <textarea id={id} rows={9}value={text} onChange={(event) => setText(event.currentTarget.value)} />
      </label>
      <div className="fd-act pf-act">
        {threaded ? (
          <button type="button" onClick={send} disabled={busy !== null || text.trim().length < 20}>
            <BusyIcon on={busy === 'follow'}><Send size={14} aria-hidden="true" /></BusyIcon>
            Send follow-up
          </button>
        ) : <CopyButton value={text.trim()} label="the follow-up" />}
      </div>
      <NoticeLine notice={notice} />
    </section>
  );
}
