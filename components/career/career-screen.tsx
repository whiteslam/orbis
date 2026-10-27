'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Upload } from 'lucide-react';
import { loadCareerAction } from '@/app/career/actions';
import { FieldHead, useScrollTop } from '@/components/field/field';
import { ApplicationSheet, type SheetContext } from '@/components/career/application-sheet';
import { NoticeLine } from '@/components/career/bits';
import { ForYouView } from '@/components/career/for-you-view';
import { homeHeadline } from '@/components/career/format';
import { InsightsView } from '@/components/career/insights-view';
import { QueueView } from '@/components/career/queue-view';
import { SetupView } from '@/components/career/setup/setup-view';
import { TrackerView } from '@/components/career/tracker-view';
import { useRun } from '@/components/career/use-run';
import type { HeadsupAction } from '@/lib/headsups/types';
import type { CareerJob } from '@/lib/career/types';
import type { ApplicationCard, ApplicationDetail, CareerHome, CareerSetup } from '@/lib/career/view';

export type CareerTab = 'for_you' | 'queue' | 'tracker' | 'insights' | 'setup';

const TABS: Array<[CareerTab, string]> = [['for_you', 'For you'], ['queue', 'Queue'], ['tracker', 'Tracker'], ['insights', 'Insights'], ['setup', 'Setup']];

type OpenSheet = { jobId: string; initial: ApplicationDetail | null };

/** Every application the home knows, to find the one a heads-up named. */
function findApplication(home: CareerHome, applicationId: string): ApplicationCard | null {
  const all = [...home.queue, ...home.pipeline, ...home.followUps, ...home.upcoming];
  return all.find((card) => card.application.id === applicationId) ?? null;
}

function WeekLine({ week }: Readonly<{ week: CareerHome['week'] }>) {
  const share = Math.min(1, week.sent / Math.max(1, week.goal));
  return (
    <div className="cr-week">
      <p><b>{week.sent}</b> of {week.goal} sent this week<span>{week.sentLastWeek} last week</span></p>
      <div className="cr-meter" aria-hidden="true"><i style={{ width: `${share * 100}%` }} /></div>
    </div>
  );
}

/** The tab's switch: five views, with the queue's count beside its name. */
function CareerTabs({ tab, onTab, queue }: Readonly<{ tab: CareerTab; onTab: (tab: CareerTab) => void; queue: number }>) {
  return (
    <div className="fd-tabs glass-seg cr-seg" role="tablist" aria-label="Career">
      {TABS.map(([id, label]) => (
        <button key={id} id={`cr-tab-${id}`} type="button" role="tab" aria-selected={tab === id} aria-controls="cr-panel" onClick={() => onTab(id)}>
          {label}
          {id === 'queue' && queue > 0 && <span className="cr-badge"><span className="sr-only">, </span>{queue}<span className="sr-only"> waiting</span></span>}
        </button>
      ))}
    </div>
  );
}

/** Before a resume and a spec, every view leads to Setup. */
function FirstRun({ onSetup, hasProfile }: Readonly<{ onSetup: () => void; hasProfile: boolean }>) {
  return (
    <section className="fd-focus cr-first">
      <h2>{hasProfile ? 'Now tell Orbis what you’re looking for.' : 'Upload your resume to start.'}</h2>
      <p>
        {hasProfile
          ? 'Describe the job you want in a sentence. Orbis turns it into a spec, searches the boards every few hours, and scores each job against your profile.'
          : 'Orbis reads it into a profile of facts, searches the boards for jobs that fit, and drafts a tailored application for each good match. Nothing is sent until you press Send.'}
      </p>
      <div className="fd-act">
        <button type="button" onClick={onSetup}><Upload size={15} aria-hidden="true" />{hasProfile ? 'Write your spec' : 'Upload your resume'}</button>
      </div>
    </section>
  );
}

function ViewBody({ tab, home, context, openJobId, openCard, onSetup, reload, patchSetup }: Readonly<{
  tab: CareerTab;
  home: CareerHome;
  context: SheetContext;
  openJobId: (jobId: string) => void;
  openCard: (card: ApplicationCard) => void;
  onSetup: () => void;
  reload: () => void;
  patchSetup: (patch: Partial<CareerSetup>) => void;
}>) {
  const { state } = home;
  const setup: CareerSetup = { profile: state.profile, spec: state.spec, settings: state.settings, resumeFileName: state.resumeFileName };
  if (tab === 'setup') return <SetupView initial={setup} gmail={state.gmail} onChanged={patchSetup} />;
  if (!state.profile || !state.spec) return <FirstRun onSetup={onSetup} hasProfile={Boolean(state.profile)} />;
  if (tab === 'queue') return <QueueView queue={home.queue} followUps={home.followUps} threshold={context.threshold} onOpen={openCard} />;
  if (tab === 'tracker') return <TrackerView home={home} onOpen={openCard} onReload={reload} />;
  if (tab === 'insights') return <InsightsView initial={home.insights} spec={state.spec} />;
  return <ForYouView initial={home.hotMatches} threshold={context.threshold} onOpen={(job: CareerJob) => openJobId(job.id)} onOpenJobId={openJobId} />;
}

/**
 * The Career tab with its data in hand: the header, the switch, the view, and
 * the application sheet over it. CareerScreen below loads the data; the web
 * panel or a preview can render this directly.
 */
export function CareerView({ home, intent = null, onReload, onHome, initialTab = 'for_you', initialSheet = null }: Readonly<{
  home: CareerHome;
  intent?: HeadsupAction | null;
  onReload: () => void;
  onHome: (update: (home: CareerHome) => CareerHome) => void;
  initialTab?: CareerTab;
  initialSheet?: OpenSheet | null;
}>) {
  const [tab, setTab] = useState<CareerTab>(initialTab);
  const [sheet, setSheet] = useState<OpenSheet | null>(initialSheet);
  const [intentMiss, setIntentMiss] = useState(false);
  const top = useScrollTop(tab);
  const handledIntent = useRef(false);
  const { state } = home;
  const context: SheetContext = { profile: state.profile, threshold: state.settings.threshold, canSend: state.gmail.canSend };

  // A heads-up's application opens once, as the tab mounts from that tap.
  useEffect(() => {
    if (handledIntent.current || intent?.type !== 'open_career_application') return;
    handledIntent.current = true;
    const card = findApplication(home, intent.applicationId);
    // One-time read of the heads-up the tab was opened from.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (card) setSheet({ jobId: card.job.id, initial: null });
    else setIntentMiss(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [home, intent]);

  const openJobId = (jobId: string) => setSheet({ jobId, initial: null });
  const openCard = (card: ApplicationCard) => setSheet({ jobId: card.job.id, initial: null });
  const patchSetup = (patch: Partial<CareerSetup>) => {
    onHome((current) => ({ ...current, state: { ...current.state, ...patch } }));
    onReload();
  };
  const closeSheet = useCallback(() => setSheet(null), []);

  return (
    <>
      <div className="screen-body field cr-screen">
        <span ref={top} hidden />
        <FieldHead title="Career" />
        <div className="cr-lead">
          <p suppressHydrationWarning>{homeHeadline(home)}</p>
          <a className="cr-panel-link" href="/active/career">Open full panel<ArrowUpRight size={13} aria-hidden="true" /></a>
        </div>
        {state.profile && state.spec && <WeekLine week={home.week} />}
        {intentMiss && <NoticeLine notice={{ text: 'That application couldn’t be found. It may have been closed.', ok: false }} onDismiss={() => setIntentMiss(false)} />}
        <CareerTabs tab={tab} onTab={setTab} queue={home.counts.queue} />
        <div id="cr-panel" role="tabpanel" aria-labelledby={`cr-tab-${tab}`}>
          <ViewBody tab={tab} home={home} context={context} openJobId={openJobId} openCard={openCard} onSetup={() => setTab('setup')} reload={onReload} patchSetup={patchSetup} />
        </div>
      </div>
      {sheet && <ApplicationSheet key={sheet.jobId} jobId={sheet.jobId} initial={sheet.initial} context={context} onClose={closeSheet} onChanged={onReload} />}
    </>
  );
}

/** When the home can't load: say why, offer a retry, and still let the owner reach Setup. */
function HomeProblem({ message, onRetry, busy }: Readonly<{ message: string; onRetry: () => void; busy: boolean }>) {
  const [setup, setSetup] = useState(false);
  return (
    <div className="screen-body field cr-screen">
      <FieldHead title="Career" />
      <p className="so-problem">{message} <button type="button" className="fd-link" onClick={onRetry} disabled={busy}>Try again</button></p>
      {setup ? <SetupView initial={null} gmail={null} onChanged={onRetry} /> : (
        <p className="fd-note">Your resume, spec and sources are in <button type="button" className="fd-link" onClick={() => setSetup(true)}>Setup</button>.</p>
      )}
    </div>
  );
}

/**
 * The Career tab: For you, Queue, Tracker, Insights and Setup
 * (docs/superpowers/specs/2026-10-27-career-copilot-design.md, Screens).
 * Loads the home on mount with one action; `intent` carries a heads-up's
 * `open_career_application`, read once.
 */
export function CareerScreen({ intent }: Readonly<{ intent: HeadsupAction | null }>) {
  const [home, setHome] = useState<CareerHome | null>(null);
  const { busy, notice, run } = useRun();
  const load = useCallback(() => {
    void run('load', () => loadCareerAction(), setHome);
  }, [run]);
  useEffect(() => load(), [load]);

  if (home && !home.state.ready) {
    return (
      <div className="screen-body field cr-screen">
        <FieldHead title="Career" />
        <p className="so-problem">Career isn’t available yet: its database hasn’t been set up. Try again later.</p>
      </div>
    );
  }
  if (home) return <CareerView home={home} intent={intent} onReload={load} onHome={(update) => setHome((current) => (current ? update(current) : current))} />;
  if (notice) return <HomeProblem message={notice.text} onRetry={load} busy={busy !== null} />;
  return <div className="screen-body field cr-screen"><FieldHead title="Career" /><p className="fd-empty">Loading…</p></div>;
}
