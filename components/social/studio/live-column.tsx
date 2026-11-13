'use client';

import { ChevronRight, Plus } from 'lucide-react';
import { StatusChip } from '@/components/shorts/job-card';
import type { ShortsData } from '@/components/shorts/use-shorts-data';
import { IN_FLIGHT } from '@/lib/shorts/rules';
import type { ShortJob, WorkerPresence } from '@/lib/shorts/types';

/** The Shorts PC in two or three words; the tone colours the word, never a dot. */
const PC_STATE: Record<WorkerPresence, { text: string; tone: 'ok' | 'warn' | 'off' }> = {
  idle: { text: 'Online', tone: 'ok' },
  busy: { text: 'Making a short', tone: 'ok' },
  setup: { text: 'Needs the skill', tone: 'warn' },
  paused: { text: 'Paused', tone: 'warn' },
  offline: { text: 'Offline', tone: 'off' },
  none: { text: 'Not set up', tone: 'off' },
};

const titleOf = (job: ShortJob) => job.plan?.title ?? job.topic;

function JobRow({ job, cover, styleName, onOpen, action }: Readonly<{ job: ShortJob; cover: string | undefined; styleName: string; onOpen: () => void; action?: string }>) {
  return (
    <li>
      <button type="button" className="studio-live-row" onClick={onOpen}>
        <span className="studio-live-cover" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {cover && <img src={cover} alt="" loading="lazy" />}
        </span>
        <span className="studio-live-text">
          <b>{titleOf(job)}</b>
          <span>{styleName}</span>
        </span>
        {action ? <span className="studio-live-action">{action}</span> : <StatusChip status={job.status} />}
      </button>
    </li>
  );
}

/**
 * The Studio's right-hand column, one card: the Shorts PC's state, what waits
 * for you, what is being made, the newest finished shorts and the way to make
 * one. Under 720 px it folds into one line that opens the Shorts tab.
 */
export function LiveColumn({ data, onOpenShorts }: Readonly<{ data: ShortsData; onOpenShorts: (jobId?: string) => void }>) {
  const { view, problem, load } = data;

  if (!view) {
    return (
      <aside className="studio-side" aria-label="Shorts">
        {problem
          ? <p className="studio-live studio-live-problem">Shorts couldn’t load. <button type="button" className="studio-link" onClick={() => void load()}>Try again</button></p>
          : <div className="studio-live studio-live-skeleton" aria-hidden="true" />}
      </aside>
    );
  }

  const styleName = (slug: string) => view.styles.find((style) => style.slug === slug)?.name ?? slug;
  const needsYou = view.jobs.filter((job) => job.status === 'plan_ready');
  const making = view.jobs.filter((job) => job.status !== 'plan_ready' && IN_FLIGHT.includes(job.status));
  const finished = view.jobs.filter((job) => job.status === 'done').slice(0, 2);
  const pc = PC_STATE[view.presence];
  const phoneLine = needsYou.length ? `Shorts PC ${pc.text.toLowerCase()}, ${needsYou.length} waiting for you` : `Shorts PC ${pc.text.toLowerCase()}`;

  return (
    <aside className="studio-side" aria-label="Shorts">
      <button type="button" className="studio-live-line" onClick={() => onOpenShorts(needsYou[0]?.id)}>
        <span>{phoneLine}</span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>

      <section className="studio-live" aria-labelledby="studio-live-title">
        <div className="studio-live-head">
          <h2 id="studio-live-title" className="studio-live-h">Shorts</h2>
          <span className={`studio-live-state is-${pc.tone}`}>PC: {pc.text}</span>
        </div>
        {view.presence === 'none' && <p className="studio-live-empty">Set up the worker on the PC that makes your shorts. The steps are in the Shorts tab.</p>}

        {needsYou.length + making.length > 0 && (
          <ul className="studio-live-list" aria-label="On the go">
            {needsYou.map((job) => <JobRow key={job.id} job={job} cover={view.covers[job.id]} styleName={styleName(job.style)} onOpen={() => onOpenShorts(job.id)} action="Review" />)}
            {making.map((job) => <JobRow key={job.id} job={job} cover={view.covers[job.id]} styleName={styleName(job.style)} onOpen={() => onOpenShorts(job.id)} />)}
          </ul>
        )}
        {view.presence !== 'none' && needsYou.length + making.length === 0 && <p className="studio-live-empty">Nothing being made right now.</p>}

        {finished.length > 0 && (
          <>
            <h3 className="studio-live-sub">Finished</h3>
            <ul className="studio-live-list">
              {finished.map((job) => <JobRow key={job.id} job={job} cover={view.covers[job.id]} styleName={styleName(job.style)} onOpen={() => onOpenShorts(job.id)} />)}
            </ul>
          </>
        )}

        <button type="button" className="studio-btn studio-live-make" onClick={() => onOpenShorts()}><Plus size={16} aria-hidden="true" />Make a short</button>
      </section>
    </aside>
  );
}
