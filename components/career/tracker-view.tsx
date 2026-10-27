'use client';

import { useId, useState } from 'react';
import { ChevronRight, Inbox, Link2 } from 'lucide-react';
import { attachReplyAction } from '@/app/career/actions';
import { BusyIcon, NoticeLine } from '@/components/career/bits';
import { dayMonth, dayTime, replyChance } from '@/components/career/format';
import { StatusChip } from '@/components/career/status-chip';
import { useRun } from '@/components/career/use-run';
import { STAGE_GROUPS, isOpen } from '@/lib/career/status';
import type { CareerEvent } from '@/lib/career/types';
import type { ApplicationCard, CareerHome } from '@/lib/career/view';

/** What the owner does next, from where the application stands. */
export function nextStep(card: ApplicationCard, interviewAt: string | null): string | null {
  const { application } = card;
  switch (application.status) {
    case 'opened': return 'Press “I applied” once it’s in';
    case 'sending': return 'Sending now';
    case 'sent':
    case 'acknowledged':
      if (application.followUpDraft) return 'Follow-up drafted. Review and send';
      return application.followUpDue ? `Follow up on ${dayMonth(application.followUpDue)} if quiet` : 'Waiting for a reply';
    case 'replied': return 'They wrote back. Read and answer';
    case 'assessment': return 'Complete their assessment';
    case 'interview': return interviewAt ? `Interview ${dayTime(interviewAt)}` : 'Prepare with the prep pack';
    case 'offer': return 'Confirm the terms, then get advice';
    case 'ghosted': return application.followUpDraft ? 'No reply yet. A follow-up is drafted' : 'No reply. A late one revives it';
    default: return null;
  }
}

function TrackerRow({ card, latest, interviewAt, onOpen }: Readonly<{ card: ApplicationCard; latest: string | null; interviewAt: string | null; onOpen: (card: ApplicationCard) => void }>) {
  const chance = isOpen(card.application.status) ? replyChance(card.application.prediction) : null;
  const step = nextStep(card, interviewAt);
  return (
    <li>
      <button type="button" className="cr-track" onClick={() => onOpen(card)}>
        <span className="cr-track-top">
          <b>{card.job.company}</b>
          <StatusChip status={card.application.status} />
        </span>
        <span className="cr-track-title">{card.job.title}</span>
        {latest && <span className="cr-track-latest">{latest}</span>}
        <span className="cr-track-foot">
          {step && <span className="cr-next">{step}</span>}
          {chance && <span className="cr-track-chance">{chance.text}<small>{chance.note.toLowerCase()}</small></span>}
        </span>
        <ChevronRight className="cr-track-go" size={16} aria-hidden="true" />
      </button>
    </li>
  );
}

/** A reply Orbis couldn't link: attach it to the application it belongs to. The web panel's inbox uses it too. */
export function UnmatchedReply({ event, options, onAttached }: Readonly<{ event: CareerEvent; options: ApplicationCard[]; onAttached: () => void }>) {
  const id = useId();
  // The application its company name suggests comes first; the owner decides.
  const suggested = options.find((card) => card.application.id === event.details.suggestedApplicationId);
  const [target, setTarget] = useState(suggested?.application.id ?? options[0]?.application.id ?? '');
  const from = typeof event.details.from === 'string' ? event.details.from : null;
  const snippet = typeof event.details.snippet === 'string' ? event.details.snippet : null;
  const { busy, notice, run } = useRun();
  const attach = () => run('attach', () => attachReplyAction(event.id, target), () => {
    onAttached();
  });
  return (
    <li className="cr-unmatched-item">
      <p><b>{event.summary || 'A reply'}</b><time dateTime={event.at}>{dayMonth(event.at)}</time></p>
      {from && <small className="cr-unmatched-from">From {from}</small>}
      {snippet && <small className="cr-unmatched-snippet">{snippet}</small>}
      <div className="cr-attach">
        <label htmlFor={id} className="sr-only">Which application this reply is for</label>
        <select id={id} value={target} onChange={(change) => setTarget(change.currentTarget.value)}>
          {options.map((card) => <option key={card.application.id} value={card.application.id}>{card.job.company}, {card.job.title}</option>)}
        </select>
        <button type="button" className="pf-pill primary" onClick={attach} disabled={!target || busy !== null}>
          <BusyIcon on={busy === 'attach'} size={12}><Link2 size={12} aria-hidden="true" /></BusyIcon>
          Attach
        </button>
      </div>
      <NoticeLine notice={notice} />
    </li>
  );
}

/**
 * Tracker: every application past drafting, grouped by stage, each with its
 * latest news, reply chance (a range, flagged while early) and next step.
 * Replies Orbis couldn't link sit at the top until attached.
 */
export function TrackerView({ home, onOpen, onReload }: Readonly<{ home: CareerHome; onOpen: (card: ApplicationCard) => void; onReload: () => void }>) {
  const [attached, setAttached] = useState<string[]>([]);
  const unmatched = home.unmatched.filter((event) => !attached.includes(event.id));
  const latestById = new Map<string, string>();
  for (const event of home.recent) {
    if (event.applicationId && !latestById.has(event.applicationId)) latestById.set(event.applicationId, event.summary);
  }
  const interviewById = new Map(home.upcoming.map((item) => [item.application.id, item.at]));
  // Ready drafts live in the Queue; only the ones the owner has opened belong here.
  const cards = home.pipeline.filter((card) => card.application.status !== 'ready' && card.application.status !== 'drafting');
  const attachable = home.pipeline.filter((card) => isOpen(card.application.status) || card.application.status === 'ghosted');

  return (
    <div className="cr-view">
      {unmatched.length > 0 && (
        <section className="mn-card cr-unmatched" aria-labelledby="cr-unmatched-title">
          <h2 className="fd-label" id="cr-unmatched-title"><Inbox size={12} aria-hidden="true" /> Unmatched replies</h2>
          <p className="cr-block-note">Orbis found these in your Gmail but couldn’t prove which application they answer: they aren’t in a thread Orbis sent or from the company’s own domain. Check the sender before you attach one.</p>
          <ul>
            {unmatched.map((event) => (
              <UnmatchedReply key={event.id} event={event} options={attachable} onAttached={() => { setAttached((ids) => [...ids, event.id]); onReload(); }} />
            ))}
          </ul>
        </section>
      )}

      {cards.length === 0 && (
        <section className="fd-focus cr-empty">
          <h2>No applications out yet.</h2>
          <p>Once you send one, it shows here with every reply Orbis finds, its chance of a reply, and what to do next.</p>
        </section>
      )}

      {STAGE_GROUPS.map((group) => {
        const inGroup = cards.filter((card) => group.statuses.includes(card.application.status));
        if (!inGroup.length) return null;
        const label = group.id === 'ready' ? 'Waiting on you' : group.label;
        const rows = (
          <ul className="cr-track-list">
            {inGroup.map((card) => (
              <TrackerRow key={card.application.id} card={card} latest={latestById.get(card.application.id) ?? null} interviewAt={interviewById.get(card.application.id) ?? null} onOpen={onOpen} />
            ))}
          </ul>
        );
        if (group.id === 'closed') {
          return (
            <details className={`cr-stage cr-stage-${group.id}`} key={group.id}>
              <summary><span className="cr-stage-dot" aria-hidden="true" />{label}<span className="cr-stage-n">{inGroup.length}</span></summary>
              {rows}
            </details>
          );
        }
        return (
          <section className={`cr-stage cr-stage-${group.id}`} key={group.id} aria-labelledby={`cr-stage-${group.id}`}>
            <h2 id={`cr-stage-${group.id}`}><span className="cr-stage-dot" aria-hidden="true" />{label}<span className="cr-stage-n">{inGroup.length}</span></h2>
            {rows}
          </section>
        );
      })}
    </div>
  );
}
