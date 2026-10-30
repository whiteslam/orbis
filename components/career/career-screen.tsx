'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Settings2, Upload } from 'lucide-react';
import { loadCareerAction } from '@/app/career/actions';
import { FieldHead, useScrollTop } from '@/components/field/field';
import { ApplicationSheet, type SheetContext } from '@/components/career/application-sheet';
import { NoticeLine } from '@/components/career/bits';
import { SkillsToBuild } from '@/components/career/fit-review-view';
import { ForYouView } from '@/components/career/for-you-view';
import { StageStrip, attentionItems } from '@/components/career/attention';
import { InsightsView } from '@/components/career/insights-view';
import { SetupView } from '@/components/career/setup/setup-view';
import { TodayView } from '@/components/career/today-view';
import { TrackerView } from '@/components/career/tracker-view';
import { allApplications } from '@/components/career/panel/panel-data';
import { useRun } from '@/components/career/use-run';
import type { HeadsupAction } from '@/lib/headsups/types';
import type { CareerJob } from '@/lib/career/types';
import type { ApplicationCard, ApplicationDetail, CareerHome, CareerSetup } from '@/lib/career/view';

/**
 * The views. Three are on the switch: Today (what needs you, then where things
 * stand), Jobs (find and judge, with the market numbers folded below) and
 * Applications (every one by stage). The older names still land somewhere:
 * 'queue' is Today, 'insights' is Jobs with the numbers open, and 'setup' is
 * Profile and settings, reached from its link under the title.
 */
export type CareerTab = 'today' | 'for_you' | 'queue' | 'tracker' | 'insights' | 'setup';

type SwitchTab = 'today' | 'for_you' | 'tracker';
const TABS: Array<[SwitchTab, string]> = [['today', 'Today'], ['for_you', 'Jobs'], ['tracker', 'Applications']];

/** Which switch button a view belongs under; Setup belongs under none. */
function switchOf(tab: CareerTab): SwitchTab | null {
  if (tab === 'queue' || tab === 'today') return 'today';
  if (tab === 'insights' || tab === 'for_you') return 'for_you';
  if (tab === 'tracker') return 'tracker';
  return null;
}

type OpenSheet = { jobId: string; initial: ApplicationDetail | null };

/** Every application the home knows, to find the one a heads-up named. */
function findApplication(home: CareerHome, applicationId: string): ApplicationCard | null {
  const all = [...home.queue, ...home.pipeline, ...home.followUps, ...home.upcoming];
  return all.find((card) => card.application.id === applicationId) ?? null;
}

/** The tab's switch: three views, with what needs you counted beside Today. */
function CareerTabs({ tab, onTab, waiting }: Readonly<{ tab: CareerTab; onTab: (tab: CareerTab) => void; waiting: number }>) {
  const on = switchOf(tab);
  return (
    <div className="fd-tabs glass-seg cr-seg" role="tablist" aria-label="Career">
      {TABS.map(([id, label]) => (
        <button key={id} id={`cr-tab-${id}`} type="button" role="tab" aria-selected={on === id} aria-controls="cr-panel" onClick={() => onTab(id)}>
          {label}
          {id === 'today' && waiting > 0 && <span className="cr-badge"><span className="sr-only">, </span>{waiting}<span className="sr-only"> need you</span></span>}
        </button>
      ))}
    </div>
  );
}

/** Jobs: find and judge, with the market numbers folded underneath until asked for. */
function JobsView({ home, threshold, openJobId, numbersOpen }: Readonly<{ home: CareerHome; threshold: number | null; openJobId: (jobId: string) => void; numbersOpen: boolean }>) {
  const [open, setOpen] = useState(numbersOpen);
  return (
    <>
      <ForYouView initial={home.hotMatches} threshold={threshold} languages={home.state.profile?.languages ?? []} onOpen={(job: CareerJob) => openJobId(job.id)} onOpenJobId={openJobId} />
      <details className="cr-fold" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary><span><b>Market and your numbers</b><small>Salaries, skill gaps, the best day to apply and your forecast</small></span></summary>
        {open && (
          <>
            <SkillsToBuild jobs={[...home.hotMatches, ...allApplications(home).map((card) => card.job)]} />
            <InsightsView initial={home.insights} spec={home.state.spec} />
          </>
        )}
      </details>
    </>
  );
}

/** Applications: the stage strip, then every application as a row under its stage. */
function ApplicationsView({ home, onOpen, onReload }: Readonly<{ home: CareerHome; onOpen: (card: ApplicationCard) => void; onReload: () => void }>) {
  const jump = (stage: string) => {
    const target = document.getElementById(`cr-stage-${stage}`);
    if (!target) return;
    const box = target.closest('details');
    if (box) box.open = true;
    target.scrollIntoView({ block: 'start' });
  };
  return (
    <div className="cr-apps">
      <StageStrip cards={allApplications(home)} onPick={jump} label="Jump to a stage" />
      <TrackerView home={home} onOpen={onOpen} onReload={onReload} />
    </div>
  );
}

/**
 * The line for the ?gmail= result Career's "Allow sending" came back with
 * (app/auth/gmail/callback/route.ts), and whether it is good news.
 */
export function careerGmailNotice(status: string): { text: string; ok: boolean } {
  switch (status) {
    case 'connected': return { text: 'Sending is on: Orbis can now send applications you approve.', ok: true };
    case 'send-declined': return { text: 'Sending stayed off: Google didn’t grant it. Email applications will open a Gmail draft instead.', ok: false };
    case 'cancelled': return { text: 'Sending stayed off: the Google sign-in was cancelled. Email applications will open a Gmail draft instead.', ok: false };
    case 'expired': return { text: 'That Google sign-in took too long or started on a different address. Press “Allow sending applications” in Setup to try again.', ok: false };
    case 'setup-error': return { text: 'Gmail can’t be connected right now. Try again later.', ok: false };
    default: return { text: 'Sending couldn’t be turned on just now. Try “Allow sending applications” in Setup again.', ok: false };
  }
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

function ViewBody({ tab, home, context, openJobId, openCard, onSetup, onTab, reload, patchSetup }: Readonly<{
  tab: CareerTab;
  onTab: (tab: CareerTab) => void;
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
  if (tab === 'tracker') return <ApplicationsView home={home} onOpen={openCard} onReload={reload} />;
  if (tab === 'for_you' || tab === 'insights') return <JobsView home={home} threshold={context.threshold} openJobId={openJobId} numbersOpen={tab === 'insights'} />;
  return <TodayView home={home} onOpenJobId={openJobId} onApplications={() => onTab('tracker')} onJobs={() => onTab('for_you')} />;
}

/**
 * The Career tab with its data in hand: the header, the switch, the view, and
 * the application sheet over it. CareerScreen below loads the data; the web
 * panel or a preview can render this directly.
 */
export function CareerView({ home, intent = null, onReload, onHome, initialTab = 'today', initialSheet = null, gmailNotice = null, clearGmailNotice }: Readonly<{
  home: CareerHome;
  intent?: HeadsupAction | null;
  /** The ?gmail= result of Setup's "Allow sending", shown once until dismissed. */
  gmailNotice?: string | null;
  clearGmailNotice?: () => void;
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
  const waiting = state.profile && state.spec ? attentionItems(home).length : 0;

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
          {tab === 'setup' ? (
            <button type="button" className="cr-panel-link cr-back" onClick={() => setTab('today')}><ArrowLeft size={13} aria-hidden="true" />Back to Today</button>
          ) : (
            <button type="button" className="cr-panel-link cr-setup-link" onClick={() => setTab('setup')}><Settings2 size={13} aria-hidden="true" />Profile and settings</button>
          )}
          <a className="cr-panel-link" href="/active/career">Open full panel<ArrowUpRight size={13} aria-hidden="true" /></a>
        </div>
        {gmailNotice && <NoticeLine notice={careerGmailNotice(gmailNotice)} onDismiss={clearGmailNotice} />}
        {intentMiss && <NoticeLine notice={{ text: 'That application couldn’t be found. It may have been closed.', ok: false }} onDismiss={() => setIntentMiss(false)} />}
        {tab === 'setup' ? <h2 className="cr-big cr-setup-title">Profile and settings</h2> : <CareerTabs tab={tab} onTab={setTab} waiting={waiting} />}
        <div id="cr-panel" role={tab === 'setup' ? undefined : 'tabpanel'} aria-labelledby={tab === 'setup' ? undefined : `cr-tab-${switchOf(tab)}`}>
          <ViewBody tab={tab} home={home} context={context} openJobId={openJobId} openCard={openCard} onSetup={() => setTab('setup')} onTab={setTab} reload={onReload} patchSetup={patchSetup} />
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
export function CareerScreen({ intent, gmailNotice = null, clearGmailNotice }: Readonly<{ intent: HeadsupAction | null; gmailNotice?: string | null; clearGmailNotice?: () => void }>) {
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
  if (home) {
    return (
      <CareerView
        home={home}
        intent={intent}
        onReload={load}
        onHome={(update) => setHome((current) => (current ? update(current) : current))}
        // "Allow sending" is pressed in Setup, so the round trip lands back there.
        initialTab={gmailNotice ? 'setup' : 'today'}
        gmailNotice={gmailNotice}
        clearGmailNotice={clearGmailNotice}
      />
    );
  }
  if (notice) return <HomeProblem message={notice.text} onRetry={load} busy={busy !== null} />;
  return <div className="screen-body field cr-screen"><FieldHead title="Career" /><p className="fd-empty">Loading…</p></div>;
}
