'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Upload } from 'lucide-react';
import { exportTrackerAction, runSearchNowAction } from '@/app/career/actions';
import { ApplicationSheet, type SheetContext } from '@/components/career/application-sheet';
import { SkillsToBuild } from '@/components/career/fit-review-view';
import { SetupView } from '@/components/career/setup/setup-view';
import { useRun } from '@/components/career/use-run';
import { ActivityChart } from '@/components/career/panel/activity-chart';
import { CommandPalette } from '@/components/career/panel/command-palette';
import { InsightsPage } from '@/components/career/panel/insights-page';
import { InterviewsPage } from '@/components/career/panel/interviews-page';
import { JobsPage } from '@/components/career/panel/jobs-page';
import { OffersPage } from '@/components/career/panel/offers-page';
import { HomePage } from '@/components/career/panel/home-page';
import { PanelEmpty } from '@/components/career/panel/panel-bits';
import { PanelProvider, fallbackDetail, type PanelApi } from '@/components/career/panel/panel-context';
import { allApplications, hrefFor, paletteIndex, type PaletteItem, type PanelPage } from '@/components/career/panel/panel-data';
import { PanelHeader } from '@/components/career/panel/panel-header';
import { datedName, downloadText, goTo, useHashPage, useHashQuery, useHashStage, usePaletteShortcut } from '@/components/career/panel/panel-hooks';
import { PasteDialog, QueueDrawer, StatusToast, type Toast } from '@/components/career/panel/panel-overlays';
import { PanelActions, PanelRail } from '@/components/career/panel/panel-rail';
import { PipelinePage } from '@/components/career/panel/pipeline-page';
import { TitleRow } from '@/components/career/panel/title-row';
import { SERVER_MOVES, type MoveServices } from '@/components/career/panel/use-moves';
import type { CareerJob } from '@/lib/career/types';
import { DESKTOP_LAYOUT } from '@/lib/shell/desktop';
import type { ApplicationCard, ApplicationDetail, CareerHome, CareerSetup } from '@/lib/career/view';

type Drawer = { jobId: string; fallback: ApplicationDetail | null };
type Overlay = 'palette' | 'paste' | 'queue' | null;

/** Before a resume and a spec, every page but Setup points there. */
function FirstRun({ hasProfile }: Readonly<{ hasProfile: boolean }>) {
  return (
    <PanelEmpty
      title={hasProfile ? 'Now tell Orbis what you’re looking for.' : 'Upload your resume to start.'}
      action={<a className="cr-btn primary cp-cta" href={hrefFor('setup')}><Upload size={15} aria-hidden="true" />{hasProfile ? 'Write your spec' : 'Upload your resume'}</a>}
    >
      {hasProfile
        ? 'Describe the job you want in a sentence. Orbis turns it into a spec, searches the boards every few hours, and scores each job against your profile.'
        : 'Orbis reads it into a profile of facts, searches the boards for jobs that fit, and drafts a tailored application for each good match. Nothing is sent until you press Send.'}
    </PanelEmpty>
  );
}

function PageBody({ page, query, stage, home, problem, loading, onRetry, onJobs, patchSetup }: Readonly<{
  page: PanelPage;
  query: string;
  stage: string;
  home: CareerHome | null;
  problem: string | null;
  loading: boolean;
  onRetry: () => void;
  onJobs: (jobs: CareerJob[]) => void;
  patchSetup: (patch: Partial<CareerSetup>) => void;
}>) {
  if (page === 'setup') {
    const setup: CareerSetup | null = home ? { profile: home.state.profile, spec: home.state.spec, settings: home.state.settings, resumeFileName: home.state.resumeFileName } : null;
    return <div className="cp-setup"><SetupView initial={setup} gmail={home?.state.gmail ?? null} onChanged={patchSetup} /></div>;
  }
  if (!home) {
    if (loading && !problem) return <output className="cp-loading">Loading your job hunt…</output>;
    return (
      <PanelEmpty title="Career didn’t load." action={<button type="button" className="cr-btn primary" onClick={onRetry} disabled={loading}><RefreshCw size={14} aria-hidden="true" />Try again</button>}>
        {problem ?? 'Something went wrong.'} Your resume, spec and sources are still reachable in <a className="cp-inline-link" href={hrefFor('setup')}>Setup</a>.
      </PanelEmpty>
    );
  }
  if (!home.state.ready) return <PanelEmpty title="Career isn’t available yet.">Its database hasn’t been set up. Try again later.</PanelEmpty>;
  if (!home.state.profile || !home.state.spec) return <FirstRun hasProfile={Boolean(home.state.profile)} />;
  if (page === 'pipeline') return <PipelinePage key={`${query}|${stage}`} home={home} initialSearch={query} initialStage={stage} />;
  if (page === 'jobs') return <JobsPage home={home} onJobs={onJobs} />;
  if (page === 'interviews') return <InterviewsPage home={home} />;
  if (page === 'offers') return <OffersPage home={home} />;
  if (page === 'insights') return <><SkillsToBuild jobs={[...home.hotMatches, ...allApplications(home).map((card) => card.job)]} /><ActivityChart home={home} /><InsightsPage home={home} /></>;
  return <HomePage home={home} />;
}

/** Finds a job the panel knows about, and its application if it has one. */
function findJob(home: CareerHome | null, jobs: readonly CareerJob[], jobId: string): { job: CareerJob; card: ApplicationCard | null } | null {
  const card = home ? [...allApplications(home), ...home.upcoming, ...home.followUps].find((item) => item.job.id === jobId) ?? null : null;
  if (card) return { job: card.job, card };
  const job = [...(home?.hotMatches ?? []), ...jobs].find((item) => item.id === jobId);
  return job ? { job, card: null } : null;
}

/** The rail's long actions (search now, CSV export), reported in the toast. */
function useRailActions(reload: () => void) {
  const [toast, setToast] = useState<Toast | null>(null);
  const { busy, run } = useRun();
  const runSearch = () => {
    setToast({ text: 'Searching all your sources. This can take a minute…', ok: true, busy: true });
    void run('search', () => runSearchNowAction(), (counts) => {
      reload();
      setToast({ text: `Search done: ${counts.found} new, ${counts.scored} scored, ${counts.drafted} drafted.`, ok: true, busy: false });
    }).then((data) => {
      if (data === null) setToast((current) => (current?.busy ? { text: 'The search didn’t run. Try again in a moment.', ok: false, busy: false } : current));
    });
  };
  const exportCsv = () => {
    setToast({ text: 'Preparing the tracker…', ok: true, busy: true });
    void run('export', () => exportTrackerAction(), (text) => {
      downloadText(text, datedName('orbis-career-tracker'));
      setToast({ text: 'Downloaded the tracker as a CSV file.', ok: true, busy: false });
    }).then((data) => {
      if (data === null) setToast((current) => (current?.busy ? { text: 'The tracker didn’t export. Try again in a moment.', ok: false, busy: false } : current));
    });
  };
  return { toast, setToast, busy, runSearch, exportCsv };
}

/**
 * The web panel with its data in hand (CareerPanel loads it). `home` is null
 * while loading or when the load failed (`problem` says why); the header, the
 * rail and Setup still work then. `services` swaps the board's move calls for
 * previews and tests.
 */
export function CareerPanelView({ home, who, problem = null, loading = false, onReload, onHome, services = SERVER_MOVES }: Readonly<{
  home: CareerHome | null;
  who: string | null;
  problem?: string | null;
  loading?: boolean;
  onReload: () => void;
  onHome?: (update: (home: CareerHome) => CareerHome) => void;
  services?: MoveServices;
}>) {
  const page = useHashPage();
  const query = useHashQuery();
  const stage = useHashStage();
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [knownJobs, setKnownJobs] = useState<CareerJob[]>([]);
  const rail = useRailActions(onReload);
  const { setToast } = rail;
  // Where focus goes back to when the last drawer or dialog closes (the frame is inert while one is open).
  const opener = useRef<HTMLElement | null>(null);
  const remember = () => {
    if (!opener.current && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) opener.current = document.activeElement;
  };
  const closeOverlay = useCallback(() => setOverlay(null), []);
  const openPalette = useCallback(() => {
    remember();
    setOverlay('palette');
  }, []);
  usePaletteShortcut(openPalette);

  const sheet: SheetContext = useMemo(() => ({
    profile: home?.state.profile ?? null,
    threshold: home?.state.settings.threshold ?? null,
    canSend: home?.state.gmail.canSend ?? false,
  }), [home]);

  const api: PanelApi = useMemo(() => ({
    home,
    sheet,
    services,
    openJob: (job, card = null) => {
      remember();
      setOverlay(null);
      setDrawer({ jobId: job.id, fallback: fallbackDetail(job, card, home) });
    },
    openJobId: (jobId) => {
      const found = findJob(home, knownJobs, jobId);
      remember();
      setOverlay(null);
      setDrawer({ jobId, fallback: found ? fallbackDetail(found.job, found.card, home) : null });
    },
    reload: onReload,
    say: (text, ok) => setToast({ text, ok, busy: false }),
  }), [home, sheet, services, knownJobs, onReload, setToast]);

  const pick = (item: PaletteItem) => {
    setOverlay(null);
    if (item.kind === 'page') goTo(item.page);
    else if (item.kind === 'company') goTo('pipeline', item.company);
    else api.openJobId(item.jobId);
  };

  const patchSetup = (patch: Partial<CareerSetup>) => {
    onHome?.((current) => ({ ...current, state: { ...current.state, ...patch } }));
    onReload();
  };
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const covered = drawer !== null || overlay !== null;
  useEffect(() => {
    if (covered || !opener.current) return;
    opener.current.focus({ preventScroll: true });
    opener.current = null;
  }, [covered]);

  const actions = {
    onSearch: openPalette,
    onPaste: () => { remember(); setOverlay('paste'); },
    onRunSearch: rail.runSearch,
    onQueue: () => { remember(); setOverlay('queue'); },
    onExport: rail.exportCsv,
    queueCount: home?.counts.queue ?? 0,
    busy: rail.busy,
  };

  return (
    <PanelProvider value={api}>
      <div className="cp-panel">
        <div className="cp-wall" aria-hidden="true" />
        <a className="cp-skip" href="#cp-main">Skip to content</a>
        <div className="cp-frame" inert={covered}>
          <PanelHeader page={page} who={who} />
          <PanelRail {...actions} />
          <main id="cp-main" className={`cp-main cp-page-${page}`} tabIndex={-1} aria-labelledby="cp-title">
            <TitleRow page={page} home={home} actions={DESKTOP_LAYOUT ? <PanelActions page={page} {...actions} /> : null} />
            <PageBody page={page} query={query} stage={stage} home={home} problem={problem} loading={loading} onRetry={onReload} onJobs={setKnownJobs} patchSetup={patchSetup} />
          </main>
        </div>
        <StatusToast toast={rail.toast} onDismiss={() => rail.setToast(null)} />
        {overlay === 'palette' && <CommandPalette items={paletteIndex(home, knownJobs)} onPick={pick} onClose={closeOverlay} />}
        {overlay === 'paste' && <PasteDialog onClose={closeOverlay} onPasted={(jobId) => { setOverlay(null); onReload(); api.openJobId(jobId); }} />}
        {overlay === 'queue' && home && <QueueDrawer home={home} threshold={sheet.threshold} onClose={closeOverlay} onOpen={(card) => api.openJob(card.job, card)} />}
        {drawer && (
          <>
            <div className="cp-scrim" aria-hidden="true" onClick={closeDrawer} />
            <ApplicationSheet key={drawer.jobId} jobId={drawer.jobId} fallback={drawer.fallback} context={sheet} onClose={closeDrawer} onChanged={onReload} className="cp-drawer" />
          </>
        )}
      </div>
    </PanelProvider>
  );
}
