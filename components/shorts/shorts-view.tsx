'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, LoaderCircle } from 'lucide-react';
import { Intake } from '@/components/shorts/intake';
import { JobCard, StatusChip } from '@/components/shorts/job-card';
import { LibraryGrid } from '@/components/shorts/library';
import { StyleBoard, StyleDetail } from '@/components/shorts/style-board';
import { WorkerStrip } from '@/components/shorts/worker-strip';
import { YouTubePanel } from '@/components/shorts/youtube-panel';
import { AutopilotCard } from '@/components/shorts/autopilot-card';
import { HealthCard } from '@/components/shorts/health-card';
import type { ShortsData } from '@/components/shorts/use-shorts-data';
import { IN_FLIGHT, LIMITS, limitRefusal } from '@/lib/shorts/rules';

type Screen = { name: 'home' } | { name: 'style'; slug: string } | { name: 'job'; id: string };

/**
 * Social → Shorts: faceless shorts made on the owner's PC by the
 * faceless-shorts skill. The board of styles leads; a style opens its intake;
 * each short then moves plan → (your approval) → video, and finished ones
 * collect in the library.
 */
export function ShortsView({ data, openJobId = null }: Readonly<{ data: ShortsData; openJobId?: string | null }>) {
  const { view, problem, load, upsert, drop, setPaused } = data;
  const [screen, setScreen] = useState<Screen>(openJobId ? { name: 'job', id: openJobId } : { name: 'home' });

  // One short's own page polls its events; the list refresh waits meanwhile.
  useEffect(() => { setPaused(screen.name === 'job'); return () => setPaused(false); }, [screen.name, setPaused]);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [screen]);

  if (!view) {
    return (
      <div className="sh-view">
        {problem ? <p className="fd-msg bad">{problem} <button type="button" className="fd-link" onClick={() => void load()}>Try again</button></p>
          : <p className="sh-loading"><LoaderCircle className="workbook-spinner" size={16} aria-hidden="true" /> Loading Shorts…</p>}
      </div>
    );
  }

  const styleOf = (slug: string) => view.styles.find((style) => style.slug === slug);
  const back = <button type="button" className="sh-back" onClick={() => { setScreen({ name: 'home' }); void load(); }}><ArrowLeft size={15} aria-hidden="true" /> Shorts</button>;

  if (screen.name === 'job') {
    const job = view.jobs.find((item) => item.id === screen.id);
    return (
      <div className="sh-view">
        {back}
        {job
          ? <JobCard
              key={job.id} initial={job} styleName={styleOf(job.style)?.name ?? job.style} youtube={view.youtube[job.id] ?? null}
              onChanged={upsert} onDeleted={() => { drop(job.id); setScreen({ name: 'home' }); }} onQueued={() => void load()}
            />
          : <p className="fd-msg bad">That short isn’t there any more.</p>}
      </div>
    );
  }

  if (screen.name === 'style') {
    const style = styleOf(screen.slug);
    const inFlight = view.jobs.filter((job) => IN_FLIGHT.includes(job.status)).length;
    const blocked = view.presence === 'none' ? 'Set up the worker on your Shorts PC first (see the steps above).' : limitRefusal(inFlight, view.monthUsed);
    return (
      <div className="sh-view">
        {back}
        {style ? (
          <>
            <h2 className="sh-h">{style.name}</h2>
            <StyleDetail style={style} jobs={view.jobs} />
            <Intake style={style} voices={view.worker?.voices ?? []} disabledReason={blocked} onQueued={(job) => { upsert(job); setScreen({ name: 'job', id: job.id }); }} />
          </>
        ) : <p className="fd-msg bad">That style isn’t available any more.</p>}
      </div>
    );
  }

  const open = view.jobs.filter((job) => job.status !== 'done' && (IN_FLIGHT.includes(job.status) || job.status === 'failed'));
  const done = view.jobs.filter((job) => job.status === 'done');

  return (
    <div className="sh-view">
      <section className="sh-section" aria-labelledby="sh-health-h">
        <h2 id="sh-health-h" className="sh-h">How it’s running</h2>
        <HealthCard />
      </section>

      {open.length > 0 && (
        <section className="sh-section" aria-label="On the go">
          <h2 className="sh-h">On the go <span className="so-count">{open.length}</span></h2>
          <ul className="sh-open">
            {open.map((job) => (
              <li key={job.id}>
                <button type="button" className="sh-open-row" onClick={() => setScreen({ name: 'job', id: job.id })}>
                  <span className="sh-open-text">
                    <b>{job.plan?.title ?? job.topic}</b>
                    <span>{styleOf(job.style)?.name ?? job.style}</span>
                  </span>
                  <StatusChip status={job.status} />
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="sh-section" aria-label="Pick a style">
        <h2 className="sh-h">Pick a style</h2>
        <StyleBoard styles={view.styles} jobs={view.jobs} onPick={(slug) => setScreen({ name: 'style', slug })} />
      </section>

      {/* The Studio's live column shows the PC's state; the setup steps stay here when they're needed. */}
      {(view.presence === 'none' || view.presence === 'offline' || view.presence === 'setup') && <WorkerStrip presence={view.presence} worker={view.worker} />}

      <section className="sh-section" aria-labelledby="sh-auto-h">
        <h2 id="sh-auto-h" className="sh-h">Autopilot</h2>
        <AutopilotCard />
      </section>

      <section className="sh-section" aria-labelledby="sh-youtube-h">
        <h2 id="sh-youtube-h" className="sh-h">YouTube</h2>
        <YouTubePanel onChanged={() => void load()} />
      </section>

      <section className="sh-section" aria-label="Your shorts">
        <h2 className="sh-h">Your shorts <span className="so-count">{done.length}</span></h2>
        <LibraryGrid jobs={done} covers={view.covers} onOpen={(id) => setScreen({ name: 'job', id })} />
      </section>

      <p className="fd-note">{view.monthUsed} of {LIMITS.perMonth} shorts started this month. Videos are made on your Shorts PC and stored privately in Orbis. Only shorts in your YouTube queue are posted.</p>
    </div>
  );
}
