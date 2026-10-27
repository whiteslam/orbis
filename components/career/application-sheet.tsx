'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { jobDetailAction } from '@/app/career/actions';
import { NoticeLine } from '@/components/career/bits';
import { creditFor } from '@/components/career/format';
import { StatusChip } from '@/components/career/status-chip';
import { AtsCard, FilesRow, RemovedList } from '@/components/career/sheet/checks';
import { DraftEditor } from '@/components/career/sheet/draft-editor';
import { DraftStart } from '@/components/career/sheet/draft-start';
import { MatchSummary } from '@/components/career/sheet/match-summary';
import { OfferSection } from '@/components/career/sheet/offer-section';
import { OwnerMoves } from '@/components/career/sheet/owner-moves';
import { PrepPack } from '@/components/career/sheet/prep-pack';
import { ResumePreview } from '@/components/career/sheet/resume-preview';
import { ApplyKit, SendBar, type HandOff } from '@/components/career/sheet/send-panel';
import { FollowUp, Timeline } from '@/components/career/sheet/timeline';
import { useRun } from '@/components/career/use-run';
import type { CareerApplication, CareerJob, CareerProfile } from '@/lib/career/types';
import type { ApplicationDetail } from '@/lib/career/view';

export type SheetContext = {
  profile: CareerProfile | null;
  /** The owner's bar, marked on the score ring. */
  threshold: number | null;
  /** Whether Gmail may send; decides how the email route is described. */
  canSend: boolean;
};

const SEND_STATES = new Set(['ready', 'sending', 'failed']);

function originalOf(application: CareerApplication | null) {
  return { coverNote: application?.coverNote?.text ?? '', answers: (application?.answers ?? []).map((answer) => answer.answer) };
}

/** The application's own sections, in the order a review reads them. */
function ApplicationSections({ detail, application, context, original, handOff, setHandOff, onSent, onDetail }: Readonly<{
  detail: ApplicationDetail;
  application: CareerApplication;
  context: SheetContext;
  original: ReturnType<typeof originalOf>;
  handOff: HandOff | null;
  setHandOff: (handOff: HandOff) => void;
  onSent: (text: string) => void;
  onDetail: (detail: ApplicationDetail) => void;
}>) {
  const showKit = application.status === 'opened' || handOff !== null;
  const showOffer = application.status === 'offer' || detail.offer !== null;
  return (
    <>
      {showKit && application.status !== 'sent' && <ApplyKit application={application} detail={detail} handOff={handOff} onDetail={onDetail} />}
      {showOffer && <OfferSection applicationId={application.id} offer={detail.offer} onDetail={onDetail} />}
      {application.prep && <PrepPack prep={application.prep} profile={context.profile} />}
      <FollowUp application={application} job={detail.job} events={detail.events} name={context.profile?.contact.name ?? ''} onDetail={onDetail} />
      {application.draft && <ResumePreview draft={application.draft} profile={context.profile} />}
      <DraftEditor application={application} profile={context.profile} original={original} highlights={detail.highlights} onDetail={onDetail} />
      <RemovedList removed={application.removed} />
      <AtsCard report={application.ats} />
      <FilesRow files={detail.files} />
      <Timeline events={detail.events} />
      <OwnerMoves applicationId={application.id} onDetail={onDetail} />
      {SEND_STATES.has(application.status) && <SendBar application={application} canSend={context.canSend} onDetail={onDetail} onHandOff={setHandOff} onSent={onSent} />}
    </>
  );
}

/**
 * Everything about one job and its application: the score and its reasons,
 * the draft (or the button that writes one), the checks, the files, Send and
 * what follows it. Not tied to a container, so the web panel can put it in a
 * side drawer; ApplicationSheet below wraps it as the phone's sheet.
 */
export function ApplicationDetailView({ detail, context, onDetail }: Readonly<{ detail: ApplicationDetail; context: SheetContext; onDetail: (detail: ApplicationDetail) => void }>) {
  const [original] = useState(() => originalOf(detail.application));
  const [handOff, setHandOff] = useState<HandOff | null>(null);
  const [sentNote, setSentNote] = useState<string | null>(null);
  const { application, job } = detail;
  const setJob = (next: CareerJob) => onDetail({ ...detail, job: next });

  return (
    <div className="cr-detail">
      <MatchSummary job={job} threshold={context.threshold} prediction={application?.prediction ?? null} />
      {sentNote && <NoticeLine notice={{ text: sentNote, ok: true }} onDismiss={() => setSentNote(null)} />}
      {application ? (
        <ApplicationSections detail={detail} application={application} context={context} original={original} handOff={handOff} setHandOff={setHandOff} onSent={setSentNote} onDetail={onDetail} />
      ) : (
        <DraftStart job={job} onDetail={onDetail} onJob={setJob} />
      )}
    </div>
  );
}

/** Focus moves into the sheet on open and back to its opener on close; Escape closes. */
function useSheetFocus(onClose: () => void) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus({ preventScroll: true });
    return () => opener?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Ask Orbis and Settings can sit over this sheet; they own Escape while open.
      if (document.querySelector('.talk-sheet, .settings-sheet')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return headingRef;
}

/**
 * The application sheet: a full-screen `<dialog>` over the Career tab, above
 * everything but the tab bar (as Settings is). Loads the job's detail itself
 * unless `initial` is given, and reports every change through `onChanged` so
 * the lists behind it stay true.
 */
export function ApplicationSheet({ jobId, initial = null, fallback = null, context, onClose, onChanged, className }: Readonly<{
  jobId: string;
  initial?: ApplicationDetail | null;
  /**
   * What the opener already knows (the job, its application): shown at once
   * while the detail loads, and kept if the load fails. Unlike `initial`, the
   * detail is still loaded and replaces it.
   */
  fallback?: ApplicationDetail | null;
  context: SheetContext;
  onClose: () => void;
  onChanged?: (detail: ApplicationDetail) => void;
  /** Extra classes, e.g. the panel's drawer variant. */
  className?: string;
}>) {
  const [detail, setDetail] = useState<ApplicationDetail | null>(initial ?? fallback);
  const { busy, notice, run } = useRun();
  const headingRef = useSheetFocus(onClose);

  useEffect(() => {
    if (initial) return;
    void run('load', () => jobDetailAction(jobId), (next) => {
      setDetail(next);
    });
  }, [initial, jobId, run]);

  const update = (next: ApplicationDetail) => {
    setDetail(next);
    onChanged?.(next);
  };

  const job = detail?.job;
  return (
    <dialog open className={`cr-sheet field${className ? ` ${className}` : ''}`} aria-modal="true" aria-labelledby="cr-sheet-title">
      <header className="cr-sheet-head">
        <div className="cr-sheet-crumb">
          <p>{job?.company ?? 'Job'}</p>
          <button type="button" className="fd-round" onClick={onClose} aria-label="Close"><X size={16} strokeWidth={2.2} aria-hidden="true" /></button>
        </div>
        <h1 id="cr-sheet-title" ref={headingRef} tabIndex={-1}>{job?.title ?? 'Loading…'}</h1>
        {job && (
          <div className="cr-sheet-meta">
            {detail?.application && <StatusChip status={detail.application.status} />}
            <a className="cr-credit" href={job.url} target="_blank" rel="noopener noreferrer">
              {creditFor(job)}<ExternalLink size={10} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
        )}
      </header>
      {busy === 'load' && <output className="fd-empty">{detail ? 'Refreshing…' : 'Loading the job…'}</output>}
      <NoticeLine notice={notice} />
      {detail && <ApplicationDetailView key={detail.application?.id ?? 'none'} detail={detail} context={context} onDetail={update} />}
    </dialog>
  );
}
