'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  Check,
  HeartPulse,
  Home,
  Landmark,
  Mail,
  PenLine,
  Sparkles,
  TrendingUp,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react';
import { OrbisMark } from '@/components/brand/orbis-mark';
import { ThemeToggle } from '@/components/theme-toggle';
import { PasskeyPrompt } from '@/components/security/passkey-prompt';
import { disconnectGmailAction, syncFinanceAction } from '@/app/finance/actions';
import { WorkbookAdviceView, WorkbookAsk, adviceFromSaved, savedWhen, splitSummary, type ShownAdvice } from '@/components/health/workbook-advisor';
import { HealthLibrary, documentAdded } from '@/components/health/health-library';
import { PlanBuilder, planWeek } from '@/components/health/plan-builder';
import type { LibraryState } from '@/lib/health-docs/repository';
import type { HealthPlanRecord } from '@/lib/health-docs/types';
import { GmailReviewQueue } from '@/components/finance/gmail-review-queue';
import { ManualTransactionForm } from '@/components/finance/manual-transaction-form';
import { CurrencyCard } from '@/components/finance/currency-card';
import { TransactionList } from '@/components/finance/transaction-list';
import { SpendingSummary, money } from '@/components/finance/spending-summary';
import type { FinanceSummary } from '@/lib/finance/types';
import type { BriefWeather } from '@/lib/home/weather';
import { loadHomeBriefAction } from '@/app/home/brief-actions';
import { loadBriefPortfolioAction } from '@/app/invest/actions';
import type { BriefPortfolio } from '@/lib/home/portfolio';
import type { AiPreferences } from '@/lib/ai/preferences';
import { composeQuietRows } from '@/lib/focus/home';
import { composeNote, type HomeNote } from '@/lib/home/note';
import { trainingForToday } from '@/lib/home/training';
import { currentRoutine, missedRoutines, routinesToday } from '@/lib/routines/today';
import type { RoutinesSummary } from '@/lib/routines/types';
import { RoutineCheck } from '@/components/home/routine-check';
import type { Focus, FocusTarget } from '@/lib/focus/types';
import { FieldHead, FieldHero, FieldLabel, FieldSubHead, FocusNote, FocusSurface, QuietList, useScrollTop } from '@/components/field/field';
import { WeatherCard } from '@/components/home/weather-card';
import type { ContextNote } from '@/lib/memory/notes';
import type { FitnessPersonaSummary, HomeLocation, PersonalProfileSummary } from '@/lib/personal/repository';
import type { Integration } from '@/lib/providers/status';
import { ProfileScreen, type ProfileSection } from '@/components/personal/profile-screen';
import type { JournalSummary } from '@/lib/journal/types';
import type { NotificationSettings } from '@/lib/notifications/preferences';
import type { AppConnections } from '@/lib/providers/status';
import { InvestDashboard } from '@/components/invest/invest-dashboard';
import { StepsCard } from '@/components/health/steps-card';
import type { StepsSummary } from '@/lib/health/types';
import { safeAction } from '@/lib/client/safe-action';
import type { SavedPortfolioAdvice, SavedWorkbookAdvice } from '@/lib/ai/saved';

type Tab = 'home' | 'finance' | 'health' | 'personal' | 'investment';

const TAB_TO_HASH: Record<Tab, string> = { home: 'home', finance: 'finance', health: 'health', investment: 'invest', personal: 'profile' };
const HASH_TO_TAB = Object.fromEntries(Object.entries(TAB_TO_HASH).map(([tab, hash]) => [hash, tab as Tab])) as Record<string, Tab>;

const nav = [
  ['home', 'Home', Home],
  ['finance', 'Expense', WalletCards],
  ['health', 'Health', HeartPulse],
  ['investment', 'Invest', TrendingUp],
  ['personal', 'Profile', UserRound],
] as const;

// Home leads with one decision on a single lifted surface; everything else is a
// quiet row. What that decision is comes from composeFocus, not from the layout.
function HomeScreen({ financeSummary, stepsSummary, documentCount, plan, routines, savedAdviceAt, preferredName, aiBriefEnabled, openTab, openSettings }: { financeSummary: FinanceSummary; stepsSummary: StepsSummary; documentCount: number; plan: HealthPlanRecord | null; routines: RoutinesSummary; savedAdviceAt: string | null; preferredName: string | null; aiBriefEnabled: boolean; openTab: (target: FocusTarget) => void; openSettings: () => void }) {
  const router = useRouter();
  const [weather, setWeather] = useState<BriefWeather | null>(null);
  const [written, setWritten] = useState<string | null>(null);
  const [portfolio, setPortfolio] = useState<BriefPortfolio | null>(null);
  const firstName = preferredName?.trim().split(/\s+/)[0] || null;
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });

  const input = { finance: financeSummary, steps: stepsSummary, documentCount, portfolio };

  // The daily investing line. Holdings come from the broker, so Home asks for
  // them the way it asks for the weather, and simply has no card until they land.
  useEffect(() => {
    let live = true;
    void safeAction(loadBriefPortfolioAction, () => null)()
      .then((result) => { if (live) setPortfolio(result); });
    return () => { live = false; };
  }, []);
  // Orbis's own wording renders straight away and is what stays if the model is
  // off, unreachable or slow; a written brief only ever replaces its paragraphs
  // once they land, so Home never waits on the network to say something true.
  // The schedule is read on every render rather than memoised: a routine that
  // becomes due while Home is open should start showing without a reload.
  const due = routinesToday(routines, new Date());
  const current = currentRoutine(due);
  const composed = composeNote({
    finance: financeSummary,
    portfolio,
    weather,
    training: trainingForToday(plan?.plan ?? null),
    routine: current,
    missed: missedRoutines(due),
    name: preferredName,
  });
  const brief: HomeNote = written ? { ...composed, id: 'written', caption: written } : composed;

  // Re-asked whenever the data behind the brief changes. The action itself
  // returns the saved brief unless the numbers moved, so this is one request
  // per real change rather than one per visit.
  const dataKey = JSON.stringify([financeSummary.pendingCandidateCount, financeSummary.monthlyExpenses, stepsSummary.average7, documentCount, portfolio?.total, portfolio?.day?.value]);
  useEffect(() => {
    if (!aiBriefEnabled) {
      setWritten(null);
      return;
    }
    let live = true;
    void safeAction(loadHomeBriefAction, () => ({ state: 'off' as const }))({ weather })
      .then((result) => { if (live && result.state === 'ok') setWritten(result.caption); });
    return () => { live = false; };
  }, [aiBriefEnabled, dataKey, weather]);
  const quiet = composeQuietRows(input);
  const heading = quiet.every((row) => row.empty) ? 'Quiet today' : 'Everything else';

  return (
    <div className="screen-body field">
      <header className="fd-top">
        {/* The date is rendered in IST on both sides, but the day can turn between them. */}
        <p className="fd-date" suppressHydrationWarning>{today}</p>
        <div className="fd-top-actions">
          <ThemeToggle />
          <button className="icon-btn" type="button" aria-label="Notification settings" title="Notification settings" onClick={openSettings}><Bell size={18} /></button>
          <button className="avatar" type="button" aria-label="Open your profile" title="Profile" onClick={() => openTab('personal')}>{firstName?.charAt(0).toLocaleUpperCase() || 'G'}</button>
        </div>
      </header>

      <PasskeyPrompt />

      <FocusNote note={brief} />

      {/* The brief says what is due; this records what happened to it. */}
      {current && <RoutineCheck current={current} onAnswered={() => router.refresh()} />}

      <WeatherCard onWeather={setWeather} openPersonal={() => openTab('personal')} />

      <QuietList heading={heading} rows={quiet} onOpen={openTab} />

      <p className="fd-note">Orbis only uses what you connect or upload. Nothing above is inferred about you.</p>
    </div>
  );
}

function financeDate(value: string, withTime = false) {
  const options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeZone: 'Asia/Kolkata' };
  if (withTime) options.timeStyle = 'short';
  return new Intl.DateTimeFormat('en-IN', options).format(new Date(value));
}

type FinanceView = 'main' | 'review' | 'add';

function FinanceScreen({ summary, notice, clearNotice }: { summary: FinanceSummary; notice: string | null; clearNotice: () => void }) {
  const router = useRouter();
  const [view, setView] = useState<FinanceView>('main');
  const [isPending, startTransition] = useTransition();
  const [actionMessage, setActionMessage] = useState<{ text: string; success: boolean } | null>(null);
  const top = useScrollTop(view);

  // Atlas opens on the month's figure. The pace beside it is a rate, not a
  // comparison — nothing here stores last month's total, so claiming a
  // direction would be inventing one.
  const month = summary.month;
  const ready = summary.databaseReady && !summary.loadError;
  const monthReady = Boolean(month && ready);
  const monthName = month ? new Date(Date.UTC(month.year, month.month - 1, 1)).toLocaleDateString('en-IN', { month: 'long', timeZone: 'UTC' }) : '';
  const dayOfMonth = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', day: 'numeric' }).format(new Date()));
  const waiting = Boolean(summary.connection && ready && summary.pendingCandidateCount > 0);
  // Nothing saved and nothing waiting: the screen is a doorway, not a dashboard.
  const firstRun = ready && !summary.transactions.length && !waiting && !(month && (month.spent > 0 || month.received > 0));

  // The review queue empties as alerts are confirmed; leave it once nothing is waiting.
  useEffect(() => { if (view === 'review' && !waiting) setView('main'); }, [view, waiting]);

  function sync() {
    setActionMessage(null);
    startTransition(async () => {
      const result = await safeAction(syncFinanceAction)();
      setActionMessage({ text: result.message, success: result.success });
      if (result.success) router.refresh();
    });
  }

  function disconnect() {
    if (!window.confirm('Disconnect Gmail and remove saved transaction alert IDs from Orbis?')) return;
    setActionMessage(null);
    startTransition(async () => {
      const result = await safeAction(disconnectGmailAction)();
      setActionMessage({ text: result.message, success: result.success });
      if (result.success) router.refresh();
    });
  }

  function saved(message: string) {
    setActionMessage({ text: message, success: true });
    setView('main');
    router.refresh();
  }

  if (view === 'review') return (
    <div className="screen-body field">
      <span ref={top} hidden />
      <GmailReviewQueue candidates={summary.reviewCandidates} unparsedCount={summary.unparsedCandidateCount} pendingCount={summary.pendingCandidateCount} onBack={() => setView('main')} />
    </div>
  );

  if (view === 'add') return (
    <div className="screen-body field">
      <span ref={top} hidden />
      <ManualTransactionForm onClose={() => setView('main')} onSaved={saved} />
    </div>
  );

  const notices = (
    <>
      {notice && (
        <div className={`finance-notice ${notice === 'connected' ? 'success' : 'error'}`} role="status">
          <span>{notice === 'connected' ? 'Gmail connected.' : notice === 'cancelled' ? 'Gmail connection was cancelled.' : notice === 'setup-error' ? 'Gmail setup is incomplete. Check the Google OAuth credentials and add the local callback URL in Google Cloud.' : 'Gmail could not be connected. Check the setup and try again.'}</span>
          <button type="button" onClick={clearNotice} aria-label="Dismiss message">×</button>
        </div>
      )}
      {actionMessage && <p className={`finance-notice ${actionMessage.success ? 'success' : 'error'}`} role="status">{actionMessage.text}</p>}
    </>
  );

  if (firstRun) return (
    <div className="screen-body field">
      <span ref={top} hidden />
      <FieldHead title="Expense" />
      {notices}
      <section className="fd-focus">
        <h2>Nothing saved this month.</h2>
        <p>{summary.connection ? 'Gmail is connected. Sync to pull in new bank alerts, or add one by hand.' : 'Two ways in. Connect Gmail and bank alerts arrive on their own, or add one by hand and skip the setup entirely.'}</p>
      </section>

      <div className="fd-option">
        <span className="fd-tile" aria-hidden="true"><Mail size={18} strokeWidth={1.8} /></span>
        <div>
          <strong>{summary.connection ? 'Gmail alerts' : 'Connect Gmail'}</strong>
          <p>{summary.connection
            ? `${summary.connection.email} · ${summary.connection.status === 'connected' ? 'connected, read-only' : 'reconnect required'}`
            : 'Read-only, bank and card alerts only, never the message body. Two minutes to set up, one tap to undo.'}</p>
          <div className="fd-act">
            {!summary.connection && <a className="fd-button" href="/auth/gmail/start">Connect Gmail</a>}
            {summary.connection?.status === 'reconnect_required' && <a className="fd-button" href="/auth/gmail/start">Reconnect Gmail</a>}
            {summary.connection?.status === 'connected' && <button type="button" disabled={isPending} onClick={sync}>{isPending ? 'Syncing…' : 'Sync now'}</button>}
          </div>
        </div>
      </div>

      <div className="fd-option">
        <span className="fd-tile" aria-hidden="true"><PenLine size={18} strokeWidth={1.8} /></span>
        <div>
          <strong>Add manually</strong>
          <p>Cash spends, UPI payments, or anything Gmail would never see. Amount, category, done.</p>
          <div className="fd-act"><button className="ghost" type="button" onClick={() => setView('add')}>Add one now</button></div>
        </div>
      </div>

      {!summary.connection && <>
        <FieldLabel>What Orbis will read</FieldLabel>
        <div className="fd-check yes"><Check size={15} strokeWidth={2.2} aria-hidden="true" /><span>Bank and card alert emails</span></div>
        <div className="fd-check no"><X size={15} strokeWidth={2.2} aria-hidden="true" /><span>Message bodies, attachments, contacts</span></div>
        <div className="fd-check no"><X size={15} strokeWidth={2.2} aria-hidden="true" /><span>Sending, editing or deleting anything</span></div>
      </>}

      <CurrencyCard note="works without any account" />
      <p className="fd-note">Orbis only uses what you connect or upload. Nothing here is inferred about you.</p>
    </div>
  );

  return (
    <div className="screen-body field">
      <span ref={top} hidden />
      <FieldHead title="Expense" />
      {monthReady && month && month.spent > 0 && (
        <FieldHero
          value={money(month.spent, month.currency)}
          label={`spent in ${monthName}`}
          delta={{ text: `${money(month.spent / Math.max(dayOfMonth, 1), month.currency)} a day`, tone: 'flat' }}
        />
      )}
      {/* Connect, reconnect, sync and manual entry are the only entry points on
          this screen, so they stay under the title as a plain row. */}
      <div className="fd-act">
        {ready && !summary.connection && <a className="fd-button" href="/auth/gmail/start">Connect Gmail</a>}
        {summary.connection?.status === 'reconnect_required' && <a className="fd-button" href="/auth/gmail/start">Reconnect Gmail</a>}
        {summary.connection?.status === 'connected' && (
          <button type="button" disabled={isPending} onClick={sync}>{isPending ? 'Syncing…' : 'Sync now'}</button>
        )}
        {ready && <button className="ghost" type="button" onClick={() => setView('add')}>Add manually</button>}
      </div>

      {notices}

      {waiting && (
        <section className="fd-quiet">
          <h2>Waiting on you</h2>
          <button className="fd-line" type="button" onClick={() => setView('review')}>
            <span>Gmail alerts to review</span>
            <b>{summary.pendingCandidateCount} · Review</b>
          </button>
        </section>
      )}

      {summary.month && ready && (
        <SpendingSummary month={summary.month} />
      )}

      <FieldLabel>Latest</FieldLabel>
      {summary.transactions.length ? (
        <TransactionList transactions={summary.transactions} />
      ) : (
        <p className="fd-empty">
          {!summary.databaseReady
            ? 'Saved transactions need the finance migration applied in Supabase.'
            : summary.loadError
              ? 'Transactions could not be loaded. Refreshing the app tries again.'
              : 'Nothing saved yet. Alerts only count as spending once you confirm them.'}
        </p>
      )}

      <section className="fd-source" aria-labelledby="gmail-title">
        <div>
          <strong id="gmail-title">Gmail alerts</strong>
          {!summary.databaseReady ? (
            <p>Apply all finance, Gmail, workbook-usage and transaction-review migrations in Supabase before connecting Gmail.</p>
          ) : summary.loadError ? (
            <p>Finance data could not be loaded. Refresh the app and try again.</p>
          ) : summary.connection ? (
            <p>
              {summary.connection.email} · {summary.connection.status === 'connected' ? 'connected, read-only' : 'reconnect required'}
              {summary.connection.lastSyncAt && ` · synced ${financeDate(summary.connection.lastSyncAt, true)}`}
            </p>
          ) : (
            <p>Orbis can read bank and card alerts, but never sends, edits or deletes email.</p>
          )}
        </div>
        {ready && summary.connection?.status === 'connected' && (
          <button className="fd-link alert" type="button" disabled={isPending} onClick={disconnect}>Disconnect</button>
        )}
      </section>

      <CurrencyCard />
    </div>
  );
}

/**
 * Month-on-month change in the daily step average, or null when there is not
 * enough history to state one. Mirrors the rule in lib/focus/home.ts, so the
 * brief and the Health hero never disagree about the direction.
 */
function stepTrend(steps: StepsSummary) {
  if (steps.average30 === null || steps.previous30 === null || steps.previous30 <= 0) return null;
  return Math.round(((steps.average30 - steps.previous30) / steps.previous30) * 100);
}

// The daily step target the rings are drawn against.
const STEP_TARGET = 10_000;

type HealthView = { name: 'main' | 'ask' | 'advice' | 'docs' } | { name: 'plans'; planId: string | null };

// Main shows the first few documents; the Documents view has the rest.
const HEALTH_DOCS_ON_MAIN = 3;

function HealthScreen({ stepsSummary, healthLibrary, savedContextCount, hasSavedFitnessPersona, hasSavedPersonalProfile, savedWorkbookAdvice }: { stepsSummary: StepsSummary; healthLibrary: LibraryState; savedContextCount: number; hasSavedFitnessPersona: boolean; hasSavedPersonalProfile: boolean; savedWorkbookAdvice: SavedWorkbookAdvice | null }) {
  const [view, setView] = useState<HealthView>({ name: 'main' });
  // Advice lives here rather than in the Ask view, so a fresh answer survives
  // going back to the tab — the server copy only arrives on the next load.
  const [advice, setAdvice] = useState<ShownAdvice | null>(() => adviceFromSaved(savedWorkbookAdvice));
  const top = useScrollTop(view.name === 'plans' ? `plans-${view.planId ?? ''}` : view.name);
  const main = () => setView({ name: 'main' });
  const trend = stepTrend(stepsSummary);
  const { documents, plans } = healthLibrary;

  if (view.name === 'ask') return (
    <div className="screen-body field">
      <span ref={top} hidden />
      <WorkbookAsk hasStepData={Boolean(stepsSummary.latest)} savedContextCount={savedContextCount} hasSavedFitnessPersona={hasSavedFitnessPersona} hasSavedPersonalProfile={hasSavedPersonalProfile} onAdvice={(next) => { setAdvice(next); setView({ name: 'advice' }); }} onBack={main} />
    </div>
  );

  if (view.name === 'advice' && advice) return (
    <div className="screen-body field">
      <span ref={top} hidden />
      <WorkbookAdviceView advice={advice} onDeleted={() => { setAdvice(null); main(); }} onPlan={() => setView({ name: 'plans', planId: null })} onBack={main} />
    </div>
  );

  if (view.name === 'plans') return (
    <div className="screen-body field">
      <span ref={top} hidden />
      <PlanBuilder plans={plans} state={healthLibrary.state} initialPlanId={view.planId} onBack={main} />
    </div>
  );

  if (view.name === 'docs') return (
    <div className="screen-body field">
      <span ref={top} hidden />
      <FieldSubHead crumb="Health · documents" title="Documents" onBack={main} backLabel="Back to Health" />
      <HealthLibrary documents={documents} state={healthLibrary.state} />
    </div>
  );

  return (
    <div className="screen-body field">
      <span ref={top} hidden />
      <FieldHead title="Health" />
      {stepsSummary.average7 !== null && (
        <FieldHero
          value={Math.round(stepsSummary.average7).toLocaleString('en-IN')}
          label="steps a day, 7-day average"
          delta={trend === null || Math.abs(trend) < 1 ? null : { text: `${Math.abs(trend)}%`, tone: trend > 0 ? 'up' : 'down' }}
        />
      )}
      {/* Health opens on the rings themselves. The composed statement and the
          "Your numbers" rows said the same thing in words directly above the
          card that shows it, so both are gone rather than restated here. */}
      <StepsCard summary={stepsSummary} stepGoal={STEP_TARGET} />

      {/* Every plan has a finish line, so each row carries its bar;
          a row opens its own view, and the last row of each section is the way in. */}
      <section className="fd-quiet">
        <h2>Plans</h2>
        {plans.map((plan) => {
          const { week, total, done } = planWeek(plan);
          return (
            <button className="hl-row" type="button" key={plan.id} onClick={() => setView({ name: 'plans', planId: plan.id })}>
              <span className="hl-row-top"><strong>{plan.title}</strong><small>{done ? `${total} weeks · done` : `week ${week} of ${total}`}</small></span>
              <span className="hl-bar" aria-hidden="true"><i style={{ width: `${done ? 100 : (week / total) * 100}%` }} /></span>
            </button>
          );
        })}
        <button className="fd-line" type="button" onClick={() => setView({ name: 'plans', planId: null })}>
          <span>{plans.length ? 'All plans, or build a new one' : 'A workout, nutrition and sleep plan'}</span>
          <b className="fd-yes">{plans.length ? 'Open' : 'Build'}</b>
        </button>
      </section>

      <section className="fd-quiet">
        <h2>Documents</h2>
        {documents.slice(0, HEALTH_DOCS_ON_MAIN).map((document) => (
          <button className="fd-line" type="button" key={document.id} onClick={() => setView({ name: 'docs' })}>
            <span className="fd-two">{document.fileName}<small>{document.kind === 'pdf' ? 'PDF' : 'Excel'} · {document.alwaysInclude ? 'read in every plan' : `added ${documentAdded(document.createdAt)}`}</small></span>
            <b className="fd-yes">Open</b>
          </button>
        ))}
        <button className="fd-line" type="button" onClick={() => setView({ name: 'docs' })}>
          <span>{documents.length > HEALTH_DOCS_ON_MAIN ? `All ${documents.length} documents` : documents.length ? 'Add or manage documents' : 'Files Orbis reads when it builds a plan'}</span>
          <b className="fd-yes">{documents.length ? 'Manage' : 'Add'}</b>
        </button>
      </section>

      {advice && (
        <section className="fd-quiet">
          <h2>Advice</h2>
          <button className="fd-line" type="button" onClick={() => setView({ name: 'advice' })}>
            <span className="fd-two">{splitSummary(advice.advice.summary).headline}<small>{advice.title ?? 'Saved advice'}{advice.savedAt ? ` · saved ${savedWhen(advice.savedAt)}` : ''}</small></span>
            <b className="fd-yes">Read</b>
          </button>
        </section>
      )}

      <div className="hl-ask">
        <span>Ask about a file. Orbis reads only what you pick, and shows it first.</span>
        <button type="button" onClick={() => setView({ name: 'ask' })}>Ask</button>
      </div>
      <p className="fd-note">Suggestions are informational and aren’t a medical diagnosis.</p>
    </div>
  );
}

function GenericScreen({ tab, savedPortfolioAdvice }: { tab: Exclude<Tab, 'home' | 'finance' | 'health'>; savedPortfolioAdvice: SavedPortfolioAdvice | null }) {
  if (tab !== 'investment') return null;
  return (
    <div className="screen-body field">
      <InvestDashboard savedAdvice={savedPortfolioAdvice} />
    </div>
  );
}

export default function OrbisApp({ financeSummary, contextNotes, fitnessPersona, personalProfile, stepsSummary, homeLocation, integrations, journal, notificationSettings, appConnections, healthLibrary, savedWorkbookAdvice, savedPortfolioAdvice, aiPreferences, routines }: { financeSummary: FinanceSummary; contextNotes: { ready: boolean; notes: ContextNote[] }; fitnessPersona: FitnessPersonaSummary; personalProfile: PersonalProfileSummary; stepsSummary: StepsSummary; homeLocation: HomeLocation; integrations: Integration[]; journal: JournalSummary; notificationSettings: NotificationSettings; appConnections: AppConnections; healthLibrary: LibraryState; savedWorkbookAdvice: SavedWorkbookAdvice | null; savedPortfolioAdvice: SavedPortfolioAdvice | null; aiPreferences: AiPreferences; routines: RoutinesSummary }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('home');
  const [gmailNotice, setGmailNotice] = useState<string | null>(null);
  // Journal is the only section with a reason to open today, so it is the landing
  // one. Deep links (Home's "open settings", the Google callback) still say where to go.
  const [profileSection, setProfileSection] = useState<ProfileSection>('journal');

  // The brief is only true for as long as its data is. Re-read from the server
  // when Home comes back into view — after finishing a task in another tab, or
  // after the app has been in the background — so a done task never lingers.
  useEffect(() => {
    if (tab !== 'home') return;
    router.refresh();
    const onVisible = () => { if (document.visibilityState === 'visible') router.refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [router, tab]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const requestedTab = url.searchParams.get('tab');
    const notice = url.searchParams.get('gmail');
    // Reload keeps the current tab (#finance, #invest…); ?tab= links from OAuth take priority.
    const fromHash = HASH_TO_TAB[url.hash.slice(1)];
    if (fromHash && !requestedTab) setTab(fromHash);
    if (requestedTab === 'finance') setTab('finance');
    if (requestedTab === 'settings') {
      setProfileSection('settings');
      setTab('personal');
    }
    if (notice) setGmailNotice(notice);
    if (requestedTab || notice) {
      url.searchParams.delete('tab');
      url.searchParams.delete('gmail');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  useEffect(() => {
    const hash = tab === 'home' ? '' : `#${TAB_TO_HASH[tab]}`;
    if (window.location.hash !== hash) window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${hash}`);
  }, [tab]);

  const screen = useMemo(() => {
    if (tab === 'home') return (
      <HomeScreen
        financeSummary={financeSummary}
        stepsSummary={stepsSummary}
        documentCount={healthLibrary.documents.length}
        plan={healthLibrary.plans[0] ?? null}
        routines={routines}
        savedAdviceAt={savedWorkbookAdvice?.createdAt ?? null}
        preferredName={personalProfile.profile?.preferredName ?? null}
        aiBriefEnabled={aiPreferences.homeBriefEnabled}
        openTab={(target) => { if (target === 'personal') setProfileSection('profile'); setTab(target === 'invest' ? 'investment' : target); }}
        openSettings={() => { setProfileSection('settings'); setTab('personal'); }}
      />
    );
    if (tab === 'finance') return <FinanceScreen summary={financeSummary} notice={gmailNotice} clearNotice={() => setGmailNotice(null)} />;
    if (tab === 'health') return <HealthScreen stepsSummary={stepsSummary} healthLibrary={healthLibrary} savedContextCount={contextNotes.notes.length} hasSavedFitnessPersona={Boolean(fitnessPersona.persona)} hasSavedPersonalProfile={Boolean(personalProfile.profile)} savedWorkbookAdvice={savedWorkbookAdvice} />;
    if (tab === 'personal') {
      return (
        <ProfileScreen
          key={profileSection}
          initialSection={profileSection}
          googleNotice={profileSection === 'settings' ? gmailNotice : null}
          clearGoogleNotice={() => setGmailNotice(null)}
          openHealth={() => setTab('health')}
          personalProfile={personalProfile}
          fitnessPersona={fitnessPersona}
          contextNotes={contextNotes}
          journal={journal}
          notificationSettings={notificationSettings}
          aiPreferences={aiPreferences}
          routines={routines}
          appConnections={appConnections}
          homeLocation={homeLocation}
          integrations={integrations}
          stepsSummary={stepsSummary}
        />
      );
    }
    return <GenericScreen tab={tab} savedPortfolioAdvice={savedPortfolioAdvice} />;
  }, [appConnections, healthLibrary, contextNotes, financeSummary, fitnessPersona, gmailNotice, homeLocation, integrations, journal, notificationSettings, profileSection, personalProfile, savedPortfolioAdvice, savedWorkbookAdvice, stepsSummary, tab, aiPreferences, routines]);

  return (
    <main className="stage">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <section className="intro">
        <OrbisMark />
        <div><h1>Orbis</h1><p>Your personal intelligence system</p></div>
      </section>
      <div className="phone">
        <div className="phone-speaker" />
        <div className="phone-screen">
          {screen}
          <nav className="bottom-nav">
            {nav.map(([id, label, Icon]) => (
              <button key={id} onClick={() => setTab(id)} className={tab === id ? 'active' : ''} aria-label={label}>
                <Icon size={17}/><span>{label}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>
    </main>
  );
}
