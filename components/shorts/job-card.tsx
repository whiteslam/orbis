'use client';

import { useEffect, useRef, useState } from 'react';
import { CircleCheck, LoaderCircle, RotateCcw, Square } from 'lucide-react';
import { cancelJobAction, deleteShortAction, loadJobAction, retryJobAction } from '@/app/shorts/actions';
import { PlanEditor } from '@/components/shorts/plan-editor';
import { ShortResult } from '@/components/shorts/library';
import { safeAction } from '@/lib/client/safe-action';
import { canCancel, canRetry, isActive, mergeEvents } from '@/lib/shorts/rules';
import type { JobStatus, ShortEvent, ShortJob } from '@/lib/shorts/types';

export const STATUS_LABEL: Record<JobStatus, string> = {
  queued: 'Waiting for your PC',
  planning: 'Writing the plan',
  plan_ready: 'Plan ready for you',
  building: 'Building the video',
  done: 'Ready',
  failed: 'Didn’t finish',
  cancelled: 'Stopped',
};

export function StatusChip({ status }: Readonly<{ status: JobStatus }>) {
  return <span className={`sh-status is-${status}`}>{STATUS_LABEL[status]}</span>;
}

const POLL_MS = 3000;

/** The steps so far, the current one last, and Claude's latest words under it. */
function Timeline({ events, working }: Readonly<{ events: ShortEvent[]; working: boolean }>) {
  const steps = events.filter((event) => event.kind === 'step');
  const lastLog = [...events].reverse().find((event) => event.kind === 'log');
  const qa = events.filter((event) => event.kind === 'qa');
  if (!steps.length && !working) return null;
  return (
    <div className="sh-timeline">
      <ol aria-live="polite">
        {steps.map((step, index) => {
          const current = working && index === steps.length - 1;
          return (
            <li key={step.seq} className={current ? 'is-current' : 'is-done'}>
              {current ? <LoaderCircle className="workbook-spinner" size={14} aria-hidden="true" /> : <CircleCheck size={14} aria-hidden="true" />}
              <span>{step.content}</span>
            </li>
          );
        })}
        {working && !steps.length && <li className="is-current"><LoaderCircle className="workbook-spinner" size={14} aria-hidden="true" /><span>Waiting for your PC to pick it up</span></li>}
      </ol>
      {working && lastLog && <p className="sh-log">{lastLog.content}</p>}
      {qa.length > 0 && (
        <details className="sh-qa">
          <summary>QA fixes so far ({qa.length})</summary>
          <ul>{qa.map((event) => <li key={event.seq}>{event.content.replace(/^QA:\s*/i, '')}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

/**
 * One short, whatever stage it's at: live progress while the PC works, the
 * plan editor when the plan is ready, the player when it's done, and Retry
 * or Delete when it stopped.
 */
export function JobCard({ initial, styleName, onChanged, onDeleted }: Readonly<{ initial: ShortJob; styleName: string; onChanged: (job: ShortJob) => void; onDeleted: () => void }>) {
  const [job, setJob] = useState(initial);
  const [events, setEvents] = useState<ShortEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lastSeq = useRef(0);
  const working = isActive(job);

  // Events (and the job's status) on open, then every few seconds while the PC is on it.
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function poll() {
      const result = await safeAction(loadJobAction)(job.id, lastSeq.current);
      if (!live) return;
      if (result.success) {
        if (result.data.events.length) {
          lastSeq.current = Math.max(lastSeq.current, ...result.data.events.map((event) => event.seq));
          setEvents((have) => mergeEvents(have, result.data.events));
        }
        setJob(result.data.job);
        if (result.data.job.status !== job.status) onChanged(result.data.job);
        if (!isActive(result.data.job)) return;
      }
      timer = setTimeout(() => void poll(), POLL_MS);
    }
    void poll();
    return () => { live = false; if (timer) clearTimeout(timer); };
    // Restart only when the job's status changes: each poll carries on from lastSeq.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, job.status]);

  function changed(next: ShortJob | null, text?: string) {
    setNotice(text ?? null);
    if (next) { setJob(next); onChanged(next); }
  }

  async function run(kind: 'cancel' | 'retry' | 'delete') {
    setBusy(true);
    setMessage(null);
    if (kind === 'delete') {
      const result = await safeAction(deleteShortAction)(job.id);
      setBusy(false);
      if (!result.success) return setMessage(result.message);
      return onDeleted();
    }
    const result = await safeAction(kind === 'cancel' ? cancelJobAction : retryJobAction)(job.id);
    setBusy(false);
    if (!result.success) return setMessage(result.message);
    changed(result.data, kind === 'retry' ? 'Back in the queue.' : 'Stopped.');
  }

  const title = job.delivery?.title ?? job.plan?.title ?? job.topic;

  return (
    <article className="sh-job" aria-busy={working}>
      <header className="sh-job-head">
        <p className="sh-job-meta">{styleName} · about {job.options.seconds} s · {job.stage === 'build' ? 'video' : 'plan'}{job.attempt > 1 ? ` · try ${job.attempt}` : ''}</p>
        <h2 className="sh-job-title">{title}</h2>
        <StatusChip status={job.status} />
      </header>

      {notice && <output className="fd-msg ok">{notice}</output>}
      {message && <p className="fd-msg bad" role="alert">{message}</p>}
      {job.status === 'failed' && <p className="fd-msg bad">{job.error ?? 'This short didn’t finish.'}</p>}
      {job.planFeedback && working && job.stage === 'plan' && <p className="sh-feedback">Your notes: “{job.planFeedback}”</p>}

      {job.status !== 'done' && job.status !== 'plan_ready' && <Timeline events={events} working={working} />}

      {job.status === 'plan_ready' && job.plan && <PlanEditor key={`${job.id}-${job.attempt}-${job.plan.title}`} job={{ ...job, plan: job.plan }} onChanged={changed} />}
      {job.status === 'plan_ready' && !job.plan && <p className="fd-msg bad">The plan couldn’t be read. Discard this short and start again.</p>}

      {job.status === 'done' && <ShortResult job={job} onDeleted={onDeleted} />}

      {(working || canRetry(job) || job.status === 'cancelled') && (
        <div className="sh-actions">
          {canCancel(job) && working && (
            <button type="button" className="so-action" onClick={() => void run('cancel')} disabled={busy}>
              <Square size={14} aria-hidden="true" /><span>Stop</span>
            </button>
          )}
          {canRetry(job) && (
            <button type="button" className="so-action primary" onClick={() => void run('retry')} disabled={busy}>
              <RotateCcw size={15} aria-hidden="true" /><span>Retry</span>
            </button>
          )}
          {(job.status === 'failed' || job.status === 'cancelled') && (
            <button type="button" className="fd-link alert" onClick={() => void run('delete')} disabled={busy}>Delete</button>
          )}
        </div>
      )}
      {working && <p className="fd-note">You can leave this page: the short keeps going on your PC.</p>}
    </article>
  );
}
