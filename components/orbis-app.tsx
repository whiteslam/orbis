'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity,
  Bell,
  Brain,
  // CheckCircle2, // Habits tab is hidden for now.
  CircleDollarSign,
  Goal,
  HeartPulse,
  Home,
  Landmark,
  Mail,
  PiggyBank,
  Search,
  Sparkles,
  TrendingUp,
  UserRound,
  WalletCards,
} from 'lucide-react';
import { OrbisMark } from '@/components/brand/orbis-mark';
import { LockButton } from '@/components/security/app-lock-guard';
import { PasskeyPrompt } from '@/components/security/passkey-prompt';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { disconnectGmailAction, syncFinanceAction } from '@/app/finance/actions';
import { WorkbookAdvisor } from '@/components/health/workbook-advisor';
import { GmailReviewQueue } from '@/components/finance/gmail-review-queue';
import { ManualTransactionForm } from '@/components/finance/manual-transaction-form';
import { CurrencyCard } from '@/components/finance/currency-card';
import { TransactionList } from '@/components/finance/transaction-list';
import { SpendingSummary } from '@/components/finance/spending-summary';
import type { FinanceSummary } from '@/lib/finance/types';
import { composeBrief, type BriefWeather } from '@/lib/home/brief';
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
import type { InvestmentSummary } from '@/lib/invest/types';
import { StepsCard } from '@/components/health/steps-card';
import type { StepsSummary } from '@/lib/health/types';

type Tab = 'home' | 'finance' | 'health' | 'personal' | 'investment'; // | 'habits' — hidden for now.

const nav = [
  ['home', 'Home', Home],
  ['finance', 'Finance', WalletCards],
  ['health', 'Health', HeartPulse],
  ['investment', 'Invest', TrendingUp],
  ['personal', 'Profile', UserRound],
  // ['habits', 'Habits', CheckCircle2], // Hidden for now.
] as const;

function MetricCard({ title, value, sub, icon: Icon }: { title: string; value: string; sub?: string; icon: React.ElementType }) {
  return (
    <div className="metric-card">
      <div className="metric-icon"><Icon size={18} /></div>
      <div className="metric-copy">
        <span>{title}</span>
        <strong>{value}</strong>
        {sub && <small>{sub}</small>}
      </div>
    </div>
  );
}

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

function SectionTitle({ title, action = 'See all' }: { title: string; action?: string }) {
  return (
    <div className="section-title">
      <h3>{title}</h3>
      {action && <button>{action}</button>}
    </div>
  );
}

function HomeScreen({ financeSummary, goalsSummary, preferredName, openHealth, openPersonal }: { financeSummary: FinanceSummary; goalsSummary: GoalsSummary; preferredName: string | null; openHealth: () => void; openPersonal: () => void }) {
  const [weather, setWeather] = useState<BriefWeather | null>(null);
  const monthlyTotal = financeSummary.monthlyExpenses.length === 1 ? financeSummary.monthlyExpenses[0] : null;
  const monthlyDisplay = monthlyTotal ? money(monthlyTotal.amount, monthlyTotal.currency) : financeSummary.monthlyExpenses.length > 1 ? 'Multiple' : '—';
  const firstName = preferredName?.trim().split(/\s+/)[0] || null;
  const brief = composeBrief({ finance: financeSummary, goals: goalsSummary, name: firstName, weather });

  return (
    <div className="screen-body">
      <header className="topbar">
        <div className="avatar">{firstName?.charAt(0).toLocaleUpperCase() || 'G'}</div>
        <div className="brand"><OrbisMark size={24} />Orbis</div>
        <div className="topbar-actions">
          <button className="icon-btn" aria-label="Notifications"><Bell size={19} /></button>
          <LockButton />
          <SignOutButton />
        </div>
      </header>

      <section className="hero-copy">
        <p className="eyebrow">YOUR PERSONAL INTELLIGENCE SYSTEM</p>
        <h1>{firstName ? `Welcome back, ${firstName}.` : 'Welcome back.'}</h1>
        <p>Your life at a glance.</p>
      </section>

      <PasskeyPrompt />

      <div className="ai-brief">
        <div className="sparkle brief-monogram" aria-hidden="true">O</div>
        <div>
          <small>FROM ORBIS</small>
          {/* The greeting depends on the time of day, which can differ between server and browser render. */}
          <p suppressHydrationWarning>{brief}</p>
        </div>
      </div>

      <WeatherCard onWeather={setWeather} openPersonal={openPersonal} />

      <div className="metric-grid">
        <MetricCard title="Expenses this month" value={monthlyDisplay} sub={financeSummary.monthlyExpenses.length ? 'From saved transactions' : 'No expense data yet'} icon={CircleDollarSign} />
        <MetricCard title="Transaction alerts" value={String(financeSummary.pendingCandidateCount)} sub="Saved for review" icon={Mail} />
        <MetricCard title="Health data" value="Not added" sub="Upload a workbook" icon={Activity} />
        <MetricCard title="Goals" value={String(goalsSummary.goals.length)} sub={goalsSummary.goals.length === 1 ? 'Active goal' : 'Active goals'} icon={Goal} />
      </div>

      <SectionTitle title="Today's insights" />
      <div className="stack-card">
        <div className="insight"><PiggyBank size={18} /><p>{financeSummary.transactions.length ? `${financeSummary.transactions.length} recent transactions are available in Finance.` : 'No saved transactions yet. Add one manually or connect Gmail in Finance.'}</p></div>
        <div className="insight"><HeartPulse size={18} /><p>Health insights will appear after you upload a workbook.</p></div>
        <div className="insight"><Activity size={18} /><p>Orbis only makes suggestions from information you connect or upload.</p></div>
      </div>

      <button className="coach-card coach-card-button" type="button" onClick={openHealth}>
        <div><Brain size={21} /></div>
        <div><strong>Analyze a workbook</strong><p>Preview your data, then ask Orbis for grounded suggestions.</p></div>
        <span>›</span>
      </button>
    </div>
  );
}

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString('en-IN')}`;
  }
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
      const result = await syncFinanceAction();
      setActionMessage({ text: result.message, success: result.success });
      if (result.success) router.refresh();
    });
  }

  function disconnect() {
    if (!window.confirm('Disconnect Gmail and remove saved transaction alert IDs from Orbis?')) return;
    setActionMessage(null);
    startTransition(async () => {
      const result = await disconnectGmailAction();
      setActionMessage({ text: result.message, success: result.success });
      if (result.success) router.refresh();
    });
  }

  const monthlyTotal = summary.monthlyExpenses.length === 1 ? summary.monthlyExpenses[0] : null;
  const monthlyDisplay = monthlyTotal ? money(monthlyTotal.amount, monthlyTotal.currency) : summary.monthlyExpenses.length > 1 ? 'Multiple currencies' : '—';
  const monthlyCaption = summary.loadError ? 'Finance data could not be loaded' : summary.monthlyExpenses.length ? 'From saved transactions' : 'No expenses yet';

  return (
    <div className="screen-body grouped">
      <LargeTitle title="Finance" />
      {summary.month && summary.databaseReady && !summary.loadError ? (
        <SpendingSummary month={summary.month} />
      ) : (
        <div className="big-stat"><span>Expenses this month</span><strong>{monthlyDisplay}</strong><small>{monthlyCaption}</small></div>
      )}

      <ManualTransactionForm disabled={!summary.databaseReady || summary.loadError} />
      <CurrencyCard />

      <section className="apple-row finance-connection" aria-labelledby="gmail-title">
        <span className="category-tile" style={{ background: '#ea4335' }} aria-hidden="true"><Mail size={16} strokeWidth={2.2} /></span>
        <div className="finance-connection-copy">
          <strong id="gmail-title">Gmail alerts</strong>
          {!summary.databaseReady ? (
            <p>Apply all finance, Gmail, workbook-usage, and transaction-review migrations in Supabase before connecting Gmail.</p>
          ) : summary.loadError ? (
            <p>Finance data could not be loaded. Refresh the app and try again.</p>
          ) : summary.connection ? (
            <>
              <p>{summary.connection.email}</p>
              <small className={summary.connection.status === 'connected' ? 'connection-status' : 'connection-status needs-reconnect'}>
                {summary.connection.status === 'connected' ? 'Connected, read-only' : 'Reconnect required'}
                {summary.connection.lastSyncAt && ` · synced ${financeDate(summary.connection.lastSyncAt, true)}`}
              </small>
              {summary.pendingCandidateCount > 0 && <small>{summary.pendingCandidateCount} {summary.pendingCandidateCount === 1 ? 'alert' : 'alerts'} to review. Alerts only count as spending after you confirm them.</small>}
            </>
          ) : (
            <p>Connect Gmail to find bank and card alerts. Orbis can read email but never sends, edits, or deletes it.</p>
          )}
        </div>
        {summary.databaseReady && !summary.loadError && !summary.connection && (
          <Link className="finance-button primary" href="/auth/gmail/start">Connect</Link>
        )}
        {summary.databaseReady && !summary.loadError && summary.connection?.status === 'reconnect_required' && (
          <Link className="finance-button primary" href="/auth/gmail/start">Reconnect</Link>
        )}
        {summary.databaseReady && !summary.loadError && summary.connection?.status === 'connected' && (
          <div className="finance-actions">
            <button className="finance-button primary" type="button" disabled={isPending} onClick={sync}>
              {isPending ? 'Syncing…' : 'Sync'}
            </button>
            <button className="finance-button secondary" type="button" disabled={isPending} onClick={disconnect}>Disconnect</button>
          </div>
        )}
      </section>

      {notice && (
        <div className={`finance-notice ${notice === 'connected' ? 'success' : 'error'}`} role="status">
          <span>{notice === 'connected' ? 'Gmail connected.' : notice === 'cancelled' ? 'Gmail connection was cancelled.' : notice === 'setup-error' ? 'Gmail setup is incomplete. Check the Google OAuth credentials and add the local callback URL in Google Cloud.' : 'Gmail could not be connected. Check the setup and try again.'}</span>
          <button type="button" onClick={clearNotice} aria-label="Dismiss message">×</button>
        </div>
      )}
      {actionMessage && <p className={`finance-notice ${actionMessage.success ? 'success' : 'error'}`} role="status">{actionMessage.text}</p>}

      {summary.connection && summary.databaseReady && !summary.loadError && (
        <GmailReviewQueue candidates={summary.reviewCandidates} unparsedCount={summary.unparsedCandidateCount} />
      )}

      <h3 className="apple-section">Latest transactions</h3>
      {summary.transactions.length ? (
        <TransactionList transactions={summary.transactions} />
      ) : !summary.databaseReady ? (
        <div className="empty-state finance-empty">
          <Sparkles size={22} />
          <strong>Finance data is not set up</strong>
          <p>Apply the Supabase migration to enable saved transactions.</p>
        </div>
      ) : summary.loadError ? (
        <div className="empty-state finance-empty">
          <Sparkles size={22} />
          <strong>Finance data could not be loaded</strong>
          <p>Refresh the app to try again.</p>
        </div>
      ) : (
        <div className="empty-state finance-empty">
          <Sparkles size={22} />
          <strong>No saved transactions yet</strong>
          <p>Add one manually above, or connect Gmail. Transaction alerts never count as expenses until you confirm them.</p>
        </div>
      )}
    </div>
  );
}

// Use the user's own step goal when they have one (a goal measured in steps); a yearly or lifetime total wouldn't make sense as a daily ring, so fall back to 10,000.
function stepGoal(goalsSummary: GoalsSummary) {
  const goal = goalsSummary.goals.find((item) => /step/i.test(item.unit ?? '') && item.target >= 1_000 && item.target <= 50_000);
  return goal ? Math.round(goal.target) : 10_000;
}

function HealthScreen({ goalsSummary, stepsSummary, savedContextCount, hasSavedFitnessPersona, hasSavedPersonalProfile }: { goalsSummary: GoalsSummary; stepsSummary: StepsSummary; savedContextCount: number; hasSavedFitnessPersona: boolean; hasSavedPersonalProfile: boolean }) {
  return (
    <div className="screen-body grouped">
      <LargeTitle title="Summary" />
      <StepsCard summary={stepsSummary} stepGoal={stepGoal(goalsSummary)} />
      <h3 className="apple-section">Workbooks</h3>
      <div className="health-intro"><HeartPulse size={18} /><p>Start with a spreadsheet you already have. Orbis will show what it read before sending a summary for advice.</p></div>
      <WorkbookAdvisor goalCount={goalsSummary.goals.length} hasStepData={Boolean(stepsSummary.latest)} savedContextCount={savedContextCount} hasSavedFitnessPersona={hasSavedFitnessPersona} hasSavedPersonalProfile={hasSavedPersonalProfile} />
      <p className="health-disclaimer">Suggestions are informational and aren’t a medical diagnosis.</p>
      <h3 className="apple-section">Your goals</h3>
      <p className="health-goals-hint">Orbis uses these goals to shape its advice and plans when you ask about your data.</p>
      <GoalsHabits kind="goals" data={goalsSummary} />
    </div>
  );
}

function GenericScreen({ tab, goalsSummary, contextNotes, fitnessPersona, personalProfile, investmentSummary, homeLocation, integrations }: { tab: Exclude<Tab, 'home' | 'finance' | 'health'>; goalsSummary: GoalsSummary; contextNotes: { ready: boolean; notes: ContextNote[] }; fitnessPersona: FitnessPersonaSummary; personalProfile: PersonalProfileSummary; investmentSummary: InvestmentSummary; homeLocation: HomeLocation; integrations: Integration[] }) {
  const content = {
    personal: { title: 'Personal', icon: UserRound, text: 'Your profile, preferences, memory and important life context.' },
    investment: { title: 'Investment', icon: Landmark, text: 'Portfolio tracking and future investment intelligence will live here.' },
    // habits: { title: 'Habits', icon: CheckCircle2, text: 'Track routines, streaks and behavioral patterns.' },
  }[tab];
  const Icon = content.icon;

  return (
    <div className="screen-body">
      <header className="page-head"><div><small>ORBIS</small><h2>{content.title}</h2></div><button className="icon-btn"><Search size={19}/></button></header>
      {tab !== 'investment' && <div className="feature-hero"><div className="feature-icon"><Icon size={28}/></div><h3>{content.title}</h3><p>{content.text}</p></div>}
      {/* {tab === 'habits' && <GoalsHabits kind="habits" data={goalsSummary} />} */}
      {tab === 'investment' && <InvestDashboard summary={investmentSummary} goalCount={goalsSummary.goals.length} />}
    </div>
  );
}

export default function OrbisApp({ financeSummary, goalsSummary, contextNotes, fitnessPersona, personalProfile, investmentSummary, stepsSummary, homeLocation, integrations, journal, notificationSettings, appConnections }: { financeSummary: FinanceSummary; goalsSummary: GoalsSummary; contextNotes: { ready: boolean; notes: ContextNote[] }; fitnessPersona: FitnessPersonaSummary; personalProfile: PersonalProfileSummary; investmentSummary: InvestmentSummary; stepsSummary: StepsSummary; homeLocation: HomeLocation; integrations: Integration[]; journal: JournalSummary; notificationSettings: NotificationSettings; appConnections: AppConnections }) {
  const [tab, setTab] = useState<Tab>('home');
  const [gmailNotice, setGmailNotice] = useState<string | null>(null);
  const [profileSection, setProfileSection] = useState<ProfileSection>('profile');

  useEffect(() => {
    const url = new URL(window.location.href);
    const requestedTab = url.searchParams.get('tab');
    const notice = url.searchParams.get('gmail');
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

  const screen = useMemo(() => {
    if (tab === 'home') return <HomeScreen financeSummary={financeSummary} goalsSummary={goalsSummary} preferredName={personalProfile.profile?.preferredName ?? null} openHealth={() => setTab('health')} openPersonal={() => setTab('personal')} />;
    if (tab === 'finance') return <FinanceScreen summary={financeSummary} notice={gmailNotice} clearNotice={() => setGmailNotice(null)} />;
    if (tab === 'health') return <HealthScreen goalsSummary={goalsSummary} stepsSummary={stepsSummary} savedContextCount={contextNotes.notes.length} hasSavedFitnessPersona={Boolean(fitnessPersona.persona)} hasSavedPersonalProfile={Boolean(personalProfile.profile)} />;
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
    return <GenericScreen tab={tab} goalsSummary={goalsSummary} contextNotes={contextNotes} fitnessPersona={fitnessPersona} personalProfile={personalProfile} investmentSummary={investmentSummary} homeLocation={homeLocation} integrations={integrations} />;
  }, [appConnections, contextNotes, financeSummary, fitnessPersona, gmailNotice, goalsSummary, homeLocation, integrations, journal, notificationSettings, profileSection, investmentSummary, personalProfile, stepsSummary, tab]);

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
