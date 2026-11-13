'use client';

import { ChevronRight, Plus } from 'lucide-react';
import { StatusChip } from '@/components/shorts/job-card';
import { WORKER_LINE } from '@/components/shorts/worker-strip';
import type { ShortsData } from '@/components/shorts/use-shorts-data';
import { IN_FLIGHT } from '@/lib/shorts/rules';
import type { ShortJob, WorkerPresence } from '@/lib/shorts/types';

/** The status dot's colour: teal when the PC can work, gold when it needs a hand, grey when it's away. */
const TONE: Record<WorkerPresence, 'ok' | 'warn' | 'off'> = { idle: 'ok', busy: 'ok', setup: 'warn', paused: 'warn', offline: 'off', none: 'off' };

const titleOf = (job: ShortJob) => job.plan?.title ?? job.topic;

function JobRow({ job, cover, styleName, onOpen, action }: Readonly<{ job: ShortJob; cover: string | undefined; styleName: string; onOpen: () => void; action?: string }>) {
  return (
    <li>
      <button type="button" className="st-live-row" onClick={onOpen}>
        <span className="st-live-cover" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {cover && <img src={cover} alt="" loading="lazy" />}
        </span>
        <span className="st-live-text">
          <b>{titleOf(job)}</b>
          <span>{styleName}</span>
        </span>
        {action ? <span className="st-live-action">{action}</span> : <StatusChip status={job.status} />}
      </button>
    </li>
  );
}

/**
 * The Studio's right-hand column: whether the Shorts PC is there, what it is
 * making, what waits for you, and the newest finished shorts. Under 720 px it
 * folds into one line that opens the Shorts tab.
 */
export function LiveColumn({ data, onOpenShorts }: Readonly<{ data: ShortsData; onOpenShorts: (jobId?: string) => void }>) {
  const { view, problem, load } = data;

  if (!view) {
    return (
      <aside className="st-side" aria-label="Shorts">
        {problem
          ? <p className="st-live-card st-live-problem">Shorts couldn’t load. <button type="button" className="fd-link" onClick={() => void load()}>Try again</button></p>
          : <div className="st-live-card st-live-skeleton" aria-hidden="true" />}
      </aside>
    );
  }

  const styleName = (slug: string) => view.styles.find((style) => style.slug === slug)?.name ?? slug;
  const needsYou = view.jobs.filter((job) => job.status === 'plan_ready');
  const making = view.jobs.filter((job) => job.status !== 'plan_ready' && IN_FLIGHT.includes(job.status));
  const finished = view.jobs.filter((job) => job.status === 'done').slice(0, 2);
  const tone = TONE[view.presence];
  const phoneLine = [
    view.presence === 'none' ? 'Shorts PC not set up' : WORKER_LINE[view.presence].replace(/\.$/, ''),
    needsYou.length ? `${needsYou.length} needs you` : null,
  ].filter(Boolean).join(' · ');

  return (
    <aside className="st-side" aria-label="Shorts">
      <button type="button" className="st-live-line" onClick={() => onOpenShorts(needsYou[0]?.id)}>
        <i className={`st-dot is-${tone}`} aria-hidden="true" />
        <span>{phoneLine}</span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>

      <div className="st-live-full">
        <p className="st-live-card st-live-pc">
          <i className={`st-dot is-${tone}`} aria-hidden="true" />
          <span>{view.presence === 'none' ? 'No Shorts PC yet. Set one up in the Shorts tab.' : WORKER_LINE[view.presence]}</span>
        </p>

        <section className="st-live-card" aria-label="Shorts on the go">
          <h2 className="st-live-h">Shorts</h2>
          {needsYou.length + making.length > 0 ? (
            <ul className="st-live-list">
              {needsYou.map((job) => <JobRow key={job.id} job={job} cover={view.covers[job.id]} styleName={styleName(job.style)} onOpen={() => onOpenShorts(job.id)} action="Review" />)}
              {making.map((job) => <JobRow key={job.id} job={job} cover={view.covers[job.id]} styleName={styleName(job.style)} onOpen={() => onOpenShorts(job.id)} />)}
            </ul>
          ) : <p className="st-live-empty">Nothing being made right now.</p>}
          <button type="button" className="st-pill st-live-make" onClick={() => onOpenShorts()}><Plus size={16} aria-hidden="true" />Make a short</button>
        </section>

        {finished.length > 0 && (
          <section className="st-live-card" aria-label="Finished shorts">
            <h2 className="st-live-h">Finished</h2>
            <ul className="st-live-list">
              {finished.map((job) => <JobRow key={job.id} job={job} cover={view.covers[job.id]} styleName={styleName(job.style)} onOpen={() => onOpenShorts(job.id)} />)}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}
