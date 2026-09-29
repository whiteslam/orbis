'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  Bell,
  HeartPulse,
  Home,
  Landmark,
  Megaphone,
  PenLine,
  Sparkles,
  TrendingUp,
  UserRound,
  WalletCards,
} from 'lucide-react';
import { OrbisMark } from '@/components/brand/orbis-mark';
import { ThemeToggle } from '@/components/theme-toggle';
import { PasskeyPrompt } from '@/components/security/passkey-prompt';
import { adviceFromSaved, savedWhen, splitSummary, type ShownAdvice } from '@/lib/workbook/shown-advice';
import { documentAdded } from '@/lib/health-docs/format';
import { planWeek } from '@/lib/health/plan-week';
import type { LibraryState } from '@/lib/health-docs/repository';
import type { HealthPlanRecord } from '@/lib/health-docs/types';
import { CurrencyCard } from '@/components/finance/currency-card';
import { TransactionList } from '@/components/finance/transaction-list';
import { money } from '@/lib/finance/money';
import type { FinanceSummary } from '@/lib/finance/types';
import type { BriefWeather } from '@/lib/home/weather';
import type { BriefPortfolio } from '@/lib/home/portfolio';
import { briefReady, type WeatherPhase } from '@/lib/home/brief-gate';
import type { AiPreferences } from '@/lib/ai/preferences';
import { aiAllowed } from '@/lib/ai/consent';
import { composeQuietRows } from '@/lib/focus/home';
import { composeSocialRow } from '@/lib/focus/social';
import { indiaToday } from '@/lib/social/month';
import type { SocialPost } from '@/lib/social/types';
import { composeNote, type HomeNote } from '@/lib/home/note';
import { trainingForToday } from '@/lib/home/training';
import { currentRoutine, missedRoutines, routinesToday } from '@/lib/routines/today';
import type { RoutinesSummary } from '@/lib/routines/types';
import { RoutineCheck } from '@/components/home/routine-check';
import type { Focus, FocusTarget } from '@/lib/focus/types';
import { FieldHead, FieldHero, FieldLabel, FieldSubHead, FocusNote, FocusSurface, QuietList, useScrollTop } from '@/components/field/field';
import { WeatherCard } from '@/components/home/weather-card';
import { ImportantMail } from '@/components/home/important-mail';
import type { ContextNote } from '@/lib/memory/notes';
import type { FitnessPersonaSummary, HomeLocation, PersonalProfileSummary } from '@/lib/personal/repository';
import type { Integration } from '@/lib/providers/status';
import type { ProfileSection } from '@/components/personal/profile-screen';
import type { JournalSummary } from '@/lib/journal/types';
import type { NotificationSettings } from '@/lib/notifications/preferences';
import type { AppConnections } from '@/lib/providers/status';
import type { StepsSummary } from '@/lib/health/types';
import type { SocialMonth } from '@/lib/social/repository';
import type { SavedPortfolioAdvice, SavedWorkbookAdvice } from '@/lib/ai/saved';

// Home is what opens, so it is the only screen in the first download. Every
// other tab, and the heavier views inside Expense and Health, load the first
// time they are opened.
function TabLoading() {
  return <div className="screen-body field"><p className="fd-empty">Loading…</p></div>;
}
// For a part of a screen that already sits inside .screen-body: a second one
// would add its own padding and scroll box for the moment it shows.
function PartLoading() {
  return <p className="fd-empty">Loading…</p>;
}

const InvestDashboard = dynamic(() => import('@/components/invest/invest-dashboard').then((m) => m.InvestDashboard), { loading: PartLoading });
const SocialScreen = dynamic(() => import('@/components/social/social-screen').then((m) => m.SocialScreen), { loading: TabLoading });
const ProfileScreen = dynamic(() => import('@/components/personal/profile-screen').then((m) => m.ProfileScreen), { loading: TabLoading });
const StepsCard = dynamic(() => import('@/components/health/steps-card').then((m) => m.StepsCard), { loading: PartLoading });
const PlanBuilder = dynamic(() => import('@/components/health/plan-builder').then((m) => m.PlanBuilder), { loading: PartLoading });
const HealthLibrary = dynamic(() => import('@/components/health/health-library').then((m) => m.HealthLibrary), { loading: PartLoading });
const WorkbookAsk = dynamic(() => import('@/components/health/workbook-advisor').then((m) => m.WorkbookAsk), { loading: PartLoading });
const WorkbookAdviceView = dynamic(() => import('@/components/health/workbook-advisor').then((m) => m.WorkbookAdviceView), { loading: PartLoading });
// The mic shows on every screen but is not needed to draw Home, so it follows it.
const TalkToOrbis = dynamic(() => import('@/components/voice/talk-to-orbis').then((m) => m.TalkToOrbis));
const ManualTransactionForm = dynamic(() => import('@/components/finance/manual-transaction-form').then((m) => m.ManualTransactionForm), { loading: PartLoading });
const SpendingSummary = dynamic(() => import('@/components/finance/spending-summary').then((m) => m.SpendingSummary), { loading: PartLoading });

// Home's background reads are route handlers, not server actions: actions run
// one at a time, so a slow broker or model would hold up the user's next tap.
async function fetchJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return fallback;
    return await response.json() as T;
  } catch {
    return fallback;
  }
}

// How long Home waits for the portfolio before writing the brief without it.
const PORTFOLIO_WAIT_MS = 8_000;
// Coming back to Home re-reads it only after this long away.
const STALE_AFTER_HIDDEN_MS = 60_000;

type Tab = 'home' | 'finance' | 'health' | 'personal' | 'investment' | 'social';

const TAB_TO_HASH: Record<Tab, string> = { home: 'home', finance: 'finance', health: 'health', investment: 'invest', social: 'social', personal: 'profile' };
const HASH_TO_TAB = Object.fromEntries(Object.entries(TAB_TO_HASH).map(([tab, hash]) => [hash, tab as Tab])) as Record<string, Tab>;

const nav = [
  ['home', 'Home', Home],
  ['finance', 'Expense', WalletCards],
  ['health', 'Health', HeartPulse],
  ['investment', 'Invest', TrendingUp],
  ['social', 'Social', Megaphone],
  ['personal', 'Profile', UserRound],
] as const;

// Home leads with one decision on a single lifted surface; everything else is a
// quiet row. What that decision is comes from composeFocus, not from the layout.
function HomeScreen({ financeSummary, stepsSummary, documentCount, plan, routines, socialPosts, savedAdviceAt, preferredName, aiBriefEnabled, gmailNotice, clearGmailNotice, openTab, openSettings }: { financeSummary: FinanceSummary; stepsSummary: StepsSummary; documentCount: number; plan: HealthPlanRecord | null; routines: RoutinesSummary; socialPosts: SocialPost[]; savedAdviceAt: string | null; preferredName: string | null; aiBriefEnabled: boolean; gmailNotice: string | null; clearGmailNotice: () => void; openTab: (target: FocusTarget) => void; openSettings: () => void }) {
  const [weather, setWeather] = useState<BriefWeather | null>(null);
  const [weatherPhase, setWeatherPhase] = useState<WeatherPhase>('loading');
  const [written, setWritten] = useState<string | null>(null);
  const [portfolio, setPortfolio] = useState<BriefPortfolio | null>(null);
  const [portfolioSettled, setPortfolioSettled] = useState(false);
  const firstName = preferredName?.trim().split(/\s+/)[0] || null;
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });

  const input = { finance: financeSummary, steps: stepsSummary, documentCount, portfolio };

  // The daily investing line. Holdings come from the broker, so Home asks for
  // them the way it asks for the weather, and simply has no card until they land.
  // The brief waits for this, but never longer than PORTFOLIO_WAIT_MS: a slow
  // broker should cost the brief its investing line, not the brief itself.
  useEffect(() => {
    let live = true;
    const settle = () => { if (live) setPortfolioSettled(true); };
    const timer = setTimeout(settle, PORTFOLIO_WAIT_MS);
    void fetchJson<BriefPortfolio | null>('/api/home/portfolio', null)
      .then((result) => { if (live) setPortfolio(result); })
      .finally(() => { clearTimeout(timer); settle(); });
    return () => { live = false; clearTimeout(timer); };
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

  // Asked once the weather and the portfolio have both settled, and then again
  // only when the data behind the brief changes. The server returns the saved
  // brief unless the numbers moved, so this is one request per real change
  // rather than one per visit, or one per piece of data arriving.
  const dataKey = JSON.stringify([financeSummary.monthlyExpenses, stepsSummary.average7, documentCount, portfolio?.total, portfolio?.day?.value]);
  const ready = briefReady({ weather: weatherPhase, portfolioSettled });
  const sentKey = useRef<string | null>(null);
  useEffect(() => {
    if (!aiBriefEnabled) {
      sentKey.current = null;
      // Turning the setting off clears the cached brief immediately, rather than waiting for a refetch.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWritten(null);
      return;
    }
    if (!ready || sentKey.current === dataKey) return;
    // No cleanup that drops the answer: the ref already stops a second request
    // for this key (Strict Mode runs effects twice), so the first one must land.
    // An answer about data that has changed since is ignored instead.
    const key = dataKey;
    sentKey.current = key;
    void fetchJson<{ state: string; caption?: string }>(`/api/home/brief?weather=${encodeURIComponent(JSON.stringify(weather))}`, { state: 'off' })
      .then((result) => { if (sentKey.current === key && result.state === 'ok' && typeof result.caption === 'string') setWritten(result.caption); });
  }, [aiBriefEnabled, dataKey, ready, weather]);
  // The social row only appears for someone using the planner this month.
  const socialRow = composeSocialRow(socialPosts, indiaToday());
  const quiet = socialRow ? [...composeQuietRows(input), socialRow] : composeQuietRows(input);
  const heading = quiet.every((row) => row.empty) ? 'Quiet today' : 'Everything else';

  return (
    <div className="screen-body field">
      <header className="fd-top">
        {/* The date is rendered in IST on both sides, but the day can turn between them. */}
        <p className="fd-date" suppressHydrationWarning>{today}</p>
        <div className="fd-top-actions">
          <ThemeToggle />
          <button className="icon-btn" type="button" aria-label="Notification settings" title="Notification settings" onClick={openSettings}><Bell size={18} /></button>
          <button className="avatar" type="button" aria-label="Open your profile" title="Profile" onClick={() => openTab('personal')}>{firstName?.charAt(0).toLocaleUpperCase() || <UserRound size={16} aria-hidden="true" />}</button>
        </div>
      </header>

      <PasskeyPrompt />

      <FocusNote note={brief} />

      {/* The brief says what is due; this records what happened to it. */}
      {/* answerRoutineAction revalidates '/', so the page re-renders with the answer on its own. */}
      {current && <RoutineCheck current={current} />}

      <WeatherCard onWeather={setWeather} onPhase={setWeatherPhase} openPersonal={() => openTab('personal')} />

      {gmailNotice && (
        <div className={`finance-notice ${gmailNotice === 'connected' ? 'success' : 'error'}`} role="status">
          <span>{gmailNotice === 'connected' ? 'Gmail connected.' : gmailNotice === 'cancelled' ? 'Gmail connection was cancelled.' : gmailNotice === 'setup-error' ? 'Gmail can’t be connected right now. Try again later.' : 'Gmail could not be connected. Try again.'}</span>
          <button type="button" onClick={clearGmailNotice} aria-label="Dismiss message">×</button>
        </div>
      )}
      <ImportantMail />

      <QuietList heading={heading} rows={quiet} onOpen={openTab} />

      <p className="fd-note">Orbis only uses what you connect or upload. Nothing above is inferred about you.</p>
    </div>
  );
}

type FinanceView = 'main' | 'add';

function FinanceScreen({ summary }: { summary: FinanceSummary }) {
  const [view, setView] = useState<FinanceView>('main');
  const [actionMessage, setActionMessage] = useState<{ text: string; success: boolean } | null>(null);
  const top = useScrollTop(view);

  // Atlas opens on the month's figure. The pace beside it is a rate, not a
  // comparison — nothing here stores last month's total, so claiming a
  // direction would be inventing one.
  const month = summary.month;
  const ready = summary.databaseReady && !summary.loadError;
  const monthReady = ready && Boolean(month);
  const monthName = month ? new Date(Date.UTC(month.year, month.month - 1, 1)).toLocaleDateString('en-IN', { month: 'long', timeZone: 'UTC' }) : '';
  const dayOfMonth = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', day: 'numeric' }).format(new Date()));
  // Nothing saved: the screen is a doorway, not a dashboard.
  const firstRun = ready && !summary.transactions.length && !(month && (month.spent > 0 || month.received > 0));

  // addManualTransactionAction has already revalidated '/', so the new row is on its way.
  function saved(message: string) {
    setActionMessage({ text: message, success: true });
    setView('main');
  }

  if (view === 'add') return (
    <div className="screen-body field">
      <span ref={top} hidden />
      <ManualTransactionForm onClose={() => setView('main')} onSaved={saved} />
    </div>
  );

  const notices = actionMessage && <p className={`finance-notice ${actionMessage.success ? 'success' : 'error'}`} role="status">{actionMessage.text}</p>;

  if (firstRun) return (
    <div className="screen-body field">
      <span ref={top} hidden />
      <FieldHead title="Expense" />
      {notices}
      <section className="fd-focus">
        <h2>Nothing saved this month.</h2>
        <p>Add what you spend as it happens. Amount, category, done.</p>
      </section>

      <div className="fd-option">
        <span className="fd-tile" aria-hidden="true"><PenLine size={18} strokeWidth={1.8} /></span>
        <div>
          <strong>Add manually</strong>
          <p>Cash spends, UPI payments, cards, anything. It takes a few seconds.</p>
          <div className="fd-act"><button type="button" onClick={() => setView('add')}>Add one now</button></div>
        </div>
      </div>

      <CurrencyCard note="works without any account" />
      <p className="fd-note">Orbis only uses what you enter here. Nothing is inferred about you.</p>
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
      {/* Manual entry is the only way in, so it stays under the title as a plain row. */}
      <div className="fd-act">
        {ready && <button type="button" onClick={() => setView('add')}>Add manually</button>}
      </div>

      {notices}

      {summary.month && ready && (
        <SpendingSummary month={summary.month} />
      )}

      <FieldLabel>Latest</FieldLabel>
      {summary.transactions.length ? (
        <TransactionList transactions={summary.transactions} />
      ) : (
        <p className="fd-empty">
          {!summary.databaseReady
            ? 'Saved transactions aren’t available right now.'
            : summary.loadError
              ? 'Transactions could not be loaded. Refreshing the app tries again.'
              : 'Nothing saved yet.'}
        </p>
      )}

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

function GenericScreen({ tab, savedPortfolioAdvice, brokerNotice, clearBrokerNotice }: { tab: Exclude<Tab, 'home' | 'finance' | 'health' | 'social'>; savedPortfolioAdvice: SavedPortfolioAdvice | null; brokerNotice: string | null; clearBrokerNotice: () => void }) {
  if (tab !== 'investment') return null;
  return (
    <div className="screen-body field">
      <InvestDashboard savedAdvice={savedPortfolioAdvice} notice={brokerNotice} clearNotice={clearBrokerNotice} />
    </div>
  );
}

export default function OrbisApp({ financeSummary, contextNotes, fitnessPersona, personalProfile, stepsSummary, homeLocation, integrations, journal, notificationSettings, appConnections, healthLibrary, savedWorkbookAdvice, savedPortfolioAdvice, aiPreferences, routines, socialMonth }: { financeSummary: FinanceSummary; contextNotes: { ready: boolean; notes: ContextNote[] }; fitnessPersona: FitnessPersonaSummary; personalProfile: PersonalProfileSummary; stepsSummary: StepsSummary; homeLocation: HomeLocation; integrations: Integration[]; journal: JournalSummary; notificationSettings: NotificationSettings; appConnections: AppConnections; healthLibrary: LibraryState; savedWorkbookAdvice: SavedWorkbookAdvice | null; savedPortfolioAdvice: SavedPortfolioAdvice | null; aiPreferences: AiPreferences; routines: RoutinesSummary; socialMonth: SocialMonth & { period: string } }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('home');
  const [gmailNotice, setGmailNotice] = useState<string | null>(null);
  const [zerodhaNotice, setZerodhaNotice] = useState<string | null>(null);
  // Journal is the only section with a reason to open today, so it is the landing
  // one. Deep links (Home's "open settings", the Google callback) still say where to go.
  const [profileSection, setProfileSection] = useState<ProfileSection>('journal');

  // The brief is only true for as long as its data is. Opening the app already
  // rendered it fresh, and every save revalidates the page, so Home re-reads
  // from the server only after a real absence: the app in the background for a
  // minute or more, where a task done elsewhere could otherwise linger.
  useEffect(() => {
    if (tab !== 'home') return;
    let hiddenAt: number | null = document.visibilityState === 'hidden' ? Date.now() : null;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt !== null && Date.now() - hiddenAt >= STALE_AFTER_HIDDEN_MS) router.refresh();
      hiddenAt = null;
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [router, tab]);

  // The tab the URL asked for, until it has been applied (see the hash effect below).
  const pendingTab = useRef<Tab | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const requestedTab = url.searchParams.get('tab');
    const notice = url.searchParams.get('gmail');
    const brokerNotice = url.searchParams.get('zerodha');
    // Reload keeps the current tab (#finance, #invest…); ?tab= links from OAuth take priority (?tab=home stays on Home).
    // A tab may carry its own state after a slash (#social/2026-09); only the part before it names the tab.
    const fromHash = HASH_TO_TAB[url.hash.slice(1).split('/')[0]];
    const opening = requestedTab === 'finance' ? 'finance' : requestedTab === 'invest' ? 'investment' : requestedTab === 'settings' ? 'personal' : !requestedTab && fromHash ? fromHash : null;
    // One-time read of the URL a link arrived with, not a value the render depends on.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (requestedTab === 'settings') setProfileSection('settings');
    if (opening && opening !== 'home') {
      pendingTab.current = opening;
      setTab(opening);
    }
    if (notice) setGmailNotice(notice);
    if (brokerNotice) setZerodhaNotice(brokerNotice);
    if (requestedTab || notice || brokerNotice) {
      url.searchParams.delete('tab');
      url.searchParams.delete('gmail');
      url.searchParams.delete('zerodha');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  useEffect(() => {
    // Until the tab read from the URL is applied, this still sees 'home'; writing
    // now would erase the hash (and a tab's own state after it, like #social/2026-11).
    if (pendingTab.current) {
      if (tab !== pendingTab.current) return;
      pendingTab.current = null;
    }
    const hash = tab === 'home' ? '' : `#${TAB_TO_HASH[tab]}`;
    // Leave a tab's own state (#social/2026-09) alone while that tab is open.
    if (hash && window.location.hash.startsWith(`${hash}/`)) return;
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
        socialPosts={socialMonth.posts}
        savedAdviceAt={savedWorkbookAdvice?.createdAt ?? null}
        preferredName={personalProfile.profile?.preferredName ?? null}
        aiBriefEnabled={aiPreferences.homeBriefEnabled && aiAllowed(aiPreferences)}
        gmailNotice={gmailNotice}
        clearGmailNotice={() => setGmailNotice(null)}
        openTab={(target) => { if (target === 'personal') setProfileSection('profile'); setTab(target === 'invest' ? 'investment' : target); }}
        openSettings={() => { setProfileSection('settings'); setTab('personal'); }}
      />
    );
    if (tab === 'social') return <SocialScreen initial={socialMonth} hasProfile={Boolean(personalProfile.profile)} />;
    if (tab === 'finance') return <FinanceScreen summary={financeSummary} />;
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
    return <GenericScreen tab={tab} savedPortfolioAdvice={savedPortfolioAdvice} brokerNotice={zerodhaNotice} clearBrokerNotice={() => setZerodhaNotice(null)} />;
  }, [appConnections, healthLibrary, contextNotes, financeSummary, fitnessPersona, gmailNotice, homeLocation, integrations, journal, notificationSettings, profileSection, personalProfile, savedPortfolioAdvice, savedWorkbookAdvice, stepsSummary, tab, aiPreferences, routines, socialMonth, zerodhaNotice]);

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
          <TalkToOrbis />
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
