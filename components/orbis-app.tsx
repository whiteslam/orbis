'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  // CheckCircle2, // Habits tab is hidden for now.
  HeartPulse,
  Home,
  Landmark,
  Mail,
  Sparkles,
  TrendingUp,
  UserRound,
  WalletCards,
} from 'lucide-react';
import { OrbisMark } from '@/components/brand/orbis-mark';
import { ThemeToggle } from '@/components/theme-toggle';
import { PasskeyPrompt } from '@/components/security/passkey-prompt';
import { disconnectGmailAction, syncFinanceAction } from '@/app/finance/actions';
import { WorkbookAdvisor } from '@/components/health/workbook-advisor';
import { HealthLibrary } from '@/components/health/health-library';
import { PlanBuilder } from '@/components/health/plan-builder';
import type { LibraryState } from '@/lib/health-docs/repository';
import { GmailReviewQueue } from '@/components/finance/gmail-review-queue';
import { ManualTransactionForm } from '@/components/finance/manual-transaction-form';
import { CurrencyCard } from '@/components/finance/currency-card';
import { TransactionList } from '@/components/finance/transaction-list';
import { SpendingSummary } from '@/components/finance/spending-summary';
import type { FinanceSummary } from '@/lib/finance/types';
import type { BriefWeather } from '@/lib/home/brief';
import { composeFocus, composeQuietRows } from '@/lib/focus/home';
import type { FocusTarget } from '@/lib/focus/types';
import { FieldHead, FieldLabel, FocusSlides, FocusSurface, QuietList } from '@/components/field/field';
import { WeatherCard } from '@/components/home/weather-card';
import type { GoalsSummary } from '@/lib/goals/types';
import { GoalsHabits } from '@/components/goals/goals-habits';
import type { ContextNote } from '@/lib/goals/memory';
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

type Tab = 'home' | 'finance' | 'health' | 'personal' | 'investment'; // | 'habits' — hidden for now.

const TAB_TO_HASH: Record<Tab, string> = { home: 'home', finance: 'finance', health: 'health', investment: 'invest', personal: 'profile' };
const HASH_TO_TAB = Object.fromEntries(Object.entries(TAB_TO_HASH).map(([tab, hash]) => [hash, tab as Tab])) as Record<string, Tab>;

const nav = [
  ['home', 'Home', Home],
  ['finance', 'Finance', WalletCards],
  ['health', 'Health', HeartPulse],
  ['investment', 'Invest', TrendingUp],
  ['personal', 'Profile', UserRound],
  // ['habits', 'Habits', CheckCircle2], // Hidden for now.
] as const;

// iOS-style large title with today's date, as in the Health app's Summary.
function LargeTitle({ title }: { title: string }) {
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });
  return (
    <header className="large-title">
      <small suppressHydrationWarning>{today}</small>
      <h2>{title}</h2>
    </header>
  );
}

// Home leads with one decision on a single lifted surface; everything else is a
// quiet row. What that decision is comes from composeFocus, not from the layout.
function HomeScreen({ financeSummary, goalsSummary, stepsSummary, documentCount, savedAdviceAt, preferredName, openTab, openSettings }: { financeSummary: FinanceSummary; goalsSummary: GoalsSummary; stepsSummary: StepsSummary; documentCount: number; savedAdviceAt: string | null; preferredName: string | null; openTab: (target: FocusTarget) => void; openSettings: () => void }) {
  const [weather, setWeather] = useState<BriefWeather | null>(null);
  const firstName = preferredName?.trim().split(/\s+/)[0] || null;
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });

  const input = { finance: financeSummary, goals: goalsSummary, steps: stepsSummary, documentCount };
  const brief = composeFocus({ ...input, weather, name: preferredName, savedAdviceAt });
  const quiet = composeQuietRows(input);
  const heading = quiet.every((row) => row.empty) ? 'Quiet today' : 'Everything else';
  // Scenes switch to their night variant from the weather service, or the clock if it has not answered.
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  const night = weather?.isDay === undefined ? hour < 6 || hour >= 19 : !weather.isDay;

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

      <FocusSlides slides={brief} onAction={openTab} night={night} />

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

function FinanceScreen({ summary, notice, clearNotice }: { summary: FinanceSummary; notice: string | null; clearNotice: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [actionMessage, setActionMessage] = useState<{ text: string; success: boolean } | null>(null);

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

  return (
    <div className="screen-body field">
      <FieldHead title="Finance" />
      {/* The composed statement and the "This month" rows are gone; the month
          is read off the spending card below instead of being narrated above
          it. The controls that lived inside that statement are not — connect,
          reconnect and sync are the only entry points on this screen, so they
          stay under the title as a plain row. */}
      <div className="fd-act">
        {summary.databaseReady && !summary.loadError && !summary.connection && <a className="fd-button" href="/auth/gmail/start">Connect Gmail</a>}
        {summary.connection?.status === 'reconnect_required' && <a className="fd-button" href="/auth/gmail/start">Reconnect Gmail</a>}
        {summary.connection?.status === 'connected' && (
          <button className="fd-button" type="button" disabled={isPending} onClick={sync}>{isPending ? 'Syncing…' : 'Sync now'}</button>
        )}
      </div>

      {notice && (
        <div className={`finance-notice ${notice === 'connected' ? 'success' : 'error'}`} role="status">
          <span>{notice === 'connected' ? 'Gmail connected.' : notice === 'cancelled' ? 'Gmail connection was cancelled.' : notice === 'setup-error' ? 'Gmail setup is incomplete. Check the Google OAuth credentials and add the local callback URL in Google Cloud.' : 'Gmail could not be connected. Check the setup and try again.'}</span>
          <button type="button" onClick={clearNotice} aria-label="Dismiss message">×</button>
        </div>
      )}
      {actionMessage && <p className={`finance-notice ${actionMessage.success ? 'success' : 'error'}`} role="status">{actionMessage.text}</p>}

      {summary.month && summary.databaseReady && !summary.loadError && (
        <SpendingSummary month={summary.month} />
      )}

      {summary.connection && summary.databaseReady && !summary.loadError && summary.pendingCandidateCount > 0 && (
        <>
          <FieldLabel>Waiting on you</FieldLabel>
          <GmailReviewQueue candidates={summary.reviewCandidates} unparsedCount={summary.unparsedCandidateCount} />
        </>
      )}

      <FieldLabel>Latest transactions</FieldLabel>
      {summary.transactions.length ? (
        <TransactionList transactions={summary.transactions} />
      ) : (
        <p className="fd-empty">
          {!summary.databaseReady
            ? 'Saved transactions need the finance migration applied in Supabase.'
            : summary.loadError
              ? 'Transactions could not be loaded. Refreshing the app tries again.'
              : 'Nothing saved yet. Add one below, or connect Gmail — alerts only count as spending once you confirm them.'}
        </p>
      )}

      <FieldLabel>Add and connect</FieldLabel>
      <ManualTransactionForm disabled={!summary.databaseReady || summary.loadError} />
      <CurrencyCard />

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
        {summary.databaseReady && !summary.loadError && summary.connection?.status === 'connected' && (
          <button className="fd-link" type="button" disabled={isPending} onClick={disconnect}>Disconnect</button>
        )}
      </section>
    </div>
  );
}

// A step goal in the user's own goals wins over the default.
function stepGoal(goalsSummary: GoalsSummary) {
  const goal = goalsSummary.goals.find((item) => /step/i.test(item.unit ?? '') && item.target >= 1_000 && item.target <= 50_000);
  return goal ? Math.round(goal.target) : 10_000;
}

function HealthScreen({ goalsSummary, stepsSummary, healthLibrary, savedContextCount, hasSavedFitnessPersona, hasSavedPersonalProfile, savedWorkbookAdvice }: { goalsSummary: GoalsSummary; stepsSummary: StepsSummary; healthLibrary: LibraryState; savedContextCount: number; hasSavedFitnessPersona: boolean; hasSavedPersonalProfile: boolean; savedWorkbookAdvice: SavedWorkbookAdvice | null }) {
  return (
    <div className="screen-body field">
      <FieldHead title="Health" />
      {/* Health opens on the rings themselves. The composed statement and the
          "Your numbers" rows said the same thing in words directly above the
          card that shows it, so both are gone rather than restated here. */}
      <StepsCard summary={stepsSummary} stepGoal={stepGoal(goalsSummary)} />

      <FieldLabel>Ask about a file</FieldLabel>
      <WorkbookAdvisor goalCount={goalsSummary.goals.length} hasStepData={Boolean(stepsSummary.latest)} savedContextCount={savedContextCount} hasSavedFitnessPersona={hasSavedFitnessPersona} hasSavedPersonalProfile={hasSavedPersonalProfile} saved={savedWorkbookAdvice} />
      <p className="fd-note">Suggestions are informational and aren’t a medical diagnosis.</p>

      <FieldLabel>Plans</FieldLabel>
      <PlanBuilder plans={healthLibrary.plans} state={healthLibrary.state} />

      <FieldLabel>Documents</FieldLabel>
      <HealthLibrary documents={healthLibrary.documents} state={healthLibrary.state} />

      <FieldLabel>Goals</FieldLabel>
      <p className="fd-note">Orbis shapes its advice and plans around these whenever you ask about your data.</p>
      <GoalsHabits kind="goals" data={goalsSummary} />
    </div>
  );
}

function GenericScreen({ tab, goalsSummary, savedPortfolioAdvice }: { tab: Exclude<Tab, 'home' | 'finance' | 'health'>; goalsSummary: GoalsSummary; savedPortfolioAdvice: SavedPortfolioAdvice | null }) {
  if (tab !== 'investment') return null;
  return (
    <div className="screen-body field">
      <FieldHead title="Invest" />
      <InvestDashboard goalCount={goalsSummary.goals.length} savedAdvice={savedPortfolioAdvice} />
    </div>
  );
}

export default function OrbisApp({ financeSummary, goalsSummary, contextNotes, fitnessPersona, personalProfile, stepsSummary, homeLocation, integrations, journal, notificationSettings, appConnections, healthLibrary, savedWorkbookAdvice, savedPortfolioAdvice }: { financeSummary: FinanceSummary; goalsSummary: GoalsSummary; contextNotes: { ready: boolean; notes: ContextNote[] }; fitnessPersona: FitnessPersonaSummary; personalProfile: PersonalProfileSummary; stepsSummary: StepsSummary; homeLocation: HomeLocation; integrations: Integration[]; journal: JournalSummary; notificationSettings: NotificationSettings; appConnections: AppConnections; healthLibrary: LibraryState; savedWorkbookAdvice: SavedWorkbookAdvice | null; savedPortfolioAdvice: SavedPortfolioAdvice | null }) {
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
        goalsSummary={goalsSummary}
        stepsSummary={stepsSummary}
        documentCount={healthLibrary.documents.length}
        savedAdviceAt={savedWorkbookAdvice?.createdAt ?? null}
        preferredName={personalProfile.profile?.preferredName ?? null}
        openTab={(target) => { if (target === 'personal') setProfileSection('profile'); setTab(target === 'invest' ? 'investment' : target); }}
        openSettings={() => { setProfileSection('settings'); setTab('personal'); }}
      />
    );
    if (tab === 'finance') return <FinanceScreen summary={financeSummary} notice={gmailNotice} clearNotice={() => setGmailNotice(null)} />;
    if (tab === 'health') return <HealthScreen goalsSummary={goalsSummary} stepsSummary={stepsSummary} healthLibrary={healthLibrary} savedContextCount={contextNotes.notes.length} hasSavedFitnessPersona={Boolean(fitnessPersona.persona)} hasSavedPersonalProfile={Boolean(personalProfile.profile)} savedWorkbookAdvice={savedWorkbookAdvice} />;
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
          appConnections={appConnections}
          homeLocation={homeLocation}
          integrations={integrations}
          stepsSummary={stepsSummary}
        />
      );
    }
    return <GenericScreen tab={tab} goalsSummary={goalsSummary} savedPortfolioAdvice={savedPortfolioAdvice} />;
  }, [appConnections, healthLibrary, contextNotes, financeSummary, fitnessPersona, gmailNotice, goalsSummary, homeLocation, integrations, journal, notificationSettings, profileSection, personalProfile, savedPortfolioAdvice, savedWorkbookAdvice, stepsSummary, tab]);

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
