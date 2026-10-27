import { ChevronRight } from 'lucide-react';
import { JobCard } from '@/components/career/job-card';
import { StatusChip } from '@/components/career/status-chip';
import { dayMonth } from '@/components/career/format';
import type { ApplicationCard } from '@/lib/career/view';

function QueueCard({ card, threshold, onOpen }: Readonly<{ card: ApplicationCard; threshold: number | null; onOpen: (card: ApplicationCard) => void }>) {
  const { application } = card;
  const removed = application.removed.length;
  const ats = application.ats;
  return (
    <JobCard
      job={card.job}
      threshold={threshold}
      onOpen={() => onOpen(card)}
      actions={(
        <>
          <p className="cr-queue-facts">
            <StatusChip status={application.status} />
            {ats && <span>{ats.passed ? 'ATS check passes' : 'ATS check needs a fix'}</span>}
            {removed > 0 && <span>{removed === 1 ? '1 line removed' : `${removed} lines removed`}</span>}
          </p>
          <button type="button" className="cr-review" onClick={() => onOpen(card)}>
            Review and send
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </>
      )}
    />
  );
}

/** Drafted applications waiting for the owner's Send, and follow-ups that are due. */
export function QueueView({ queue, followUps, threshold, onOpen }: Readonly<{ queue: ApplicationCard[]; followUps: ApplicationCard[]; threshold: number | null; onOpen: (card: ApplicationCard) => void }>) {
  return (
    <div className="cr-view">
      {queue.length === 0 ? (
        <section className="fd-focus cr-empty">
          <h2>Nothing waiting for your Send.</h2>
          <p>When a job clears your bar, Orbis drafts the application and it waits here for you to review. Nothing goes out without your press.</p>
        </section>
      ) : (
        <>
          <p className="cr-count">{queue.length === 1 ? '1 application ready to review' : `${queue.length} applications ready to review`}</p>
          <div className="cr-jobs">{queue.map((card) => <QueueCard key={card.application.id} card={card} threshold={threshold} onOpen={onOpen} />)}</div>
        </>
      )}
      {followUps.length > 0 && (
        <section className="mn-card" aria-labelledby="cr-follow-list">
          <h2 className="fd-label" id="cr-follow-list">Follow-ups due</h2>
          {followUps.map((card) => (
            <button key={card.application.id} type="button" className="fd-line" onClick={() => onOpen(card)}>
              <span className="fd-two"><b>{card.job.company}</b><small>{card.job.title}, sent {dayMonth(card.application.sentAt ?? card.application.updatedAt)}</small></span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
