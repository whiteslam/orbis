'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity,
  Bell,
  Brain,
  CheckCircle2,
  CircleDollarSign,
  Goal,
  HeartPulse,
  Home,
  Landmark,
  Mail,
  PiggyBank,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  UserRound,
  WalletCards,
} from 'lucide-react';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { disconnectGmailAction, syncFinanceAction } from '@/app/finance/actions';
import { WorkbookAdvisor } from '@/components/health/workbook-advisor';
import { GmailReviewQueue } from '@/components/finance/gmail-review-queue';
import type { FinanceSummary } from '@/lib/finance/types';
import type { GoalsSummary } from '@/lib/goals/types';
import { GoalsHabits } from '@/components/goals/goals-habits';
import type { ContextNote } from '@/lib/goals/memory';
import { ContextNotes } from '@/components/personal/context-notes';

type Tab = 'home' | 'finance' | 'health' | 'personal' | 'investment' | 'goals' | 'habits';

const nav = [
  ['home', 'Home', Home],
  ['finance', 'Finance', WalletCards],
  ['health', 'Health', HeartPulse],
  ['personal', 'Personal', UserRound],
  ['investment', 'Invest', TrendingUp],
  ['goals', 'Goals', Target],
  ['habits', 'Habits', CheckCircle2],
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

function SectionTitle({ title, action = 'See all' }: { title: string; action?: string }) {
  return (
    <div className="section-title">
      <h3>{title}</h3>
      {action && <button>{action}</button>}
    </div>
  );
}

function HomeScreen({ financeSummary, goalsSummary, openHealth }: { financeSummary: FinanceSummary; goalsSummary: GoalsSummary; openHealth: () => void }) {
  const monthlyTotal = financeSummary.monthlyExpenses.length === 1 ? financeSummary.monthlyExpenses[0] : null;
  const monthlyDisplay = monthlyTotal ? money(monthlyTotal.amount, monthlyTotal.currency) : financeSummary.monthlyExpenses.length > 1 ? 'Multiple' : '—';

  return (
    <div className="screen-body">
      <header className="topbar">
        <div className="avatar">G</div>
        <div className="brand">Orbis</div>
        <div className="topbar-actions">
          <button className="icon-btn" aria-label="Notifications"><Bell size={19} /></button>
          <SignOutButton />
        </div>
      </header>

      <section className="hero-copy">
        <p className="eyebrow">YOUR PERSONAL INTELLIGENCE SYSTEM</p>
        <h1>Welcome back.</h1>
        <p>Your life at a glance.</p>
      </section>

      <div className="ai-brief">
        <div className="sparkle"><Sparkles size={18} /></div>
        <div>
          <small>ORBIS BRIEF</small>
          <p>{monthlyTotal ? `${monthlyDisplay} in saved expenses this month. Add a workbook to get insights from your health or activity data.` : 'Connect your accounts or add a workbook. Orbis will show insights here when it has your data.'}</p>
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard title="Expenses this month" value={monthlyDisplay} sub={financeSummary.monthlyExpenses.length ? 'From saved transactions' : 'No expense data yet'} icon={CircleDollarSign} />
        <MetricCard title="Transaction alerts" value={String(financeSummary.pendingCandidateCount)} sub="Saved for review" icon={Mail} />
        <MetricCard title="Health data" value="Not added" sub="Upload a workbook" icon={Activity} />
        <MetricCard title="Goals" value={String(goalsSummary.goals.length)} sub={goalsSummary.goals.length === 1 ? 'Active goal' : 'Active goals'} icon={Goal} />
      </div>

      <SectionTitle title="Today's insights" />
      <div className="stack-card">
        <div className="insight"><PiggyBank size={18} /><p>{financeSummary.transactions.length ? `${financeSummary.transactions.length} recent transactions are available in Finance.` : 'No saved transactions yet. Connect Gmail in Finance to get started.'}</p></div>
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
  const monthlyCaption = summary.loadError ? 'Finance data could not be loaded' : summary.monthlyExpenses.length ? 'From saved transactions' : 'No parsed expenses yet';

  return (
    <div className="screen-body">
      <header className="page-head"><div><small>ORBIS MONEY</small><h2>Finance</h2></div><button className="icon-btn"><Search size={19} /></button></header>
      <div className="big-stat"><span>Expenses this month</span><strong>{monthlyDisplay}</strong><small>{monthlyCaption}</small></div>

      <section className="sync-card finance-connection" aria-labelledby="gmail-title">
        <Mail size={20} aria-hidden="true" />
        <div className="finance-connection-copy">
          <strong id="gmail-title">Gmail transaction alerts</strong>
          {!summary.databaseReady ? (
            <p>Apply all finance, Gmail, workbook-usage, and transaction-review migrations in Supabase before connecting Gmail.</p>
          ) : summary.loadError ? (
            <p>Finance data could not be loaded. Refresh the app and try again.</p>
          ) : summary.connection ? (
            <>
              <p>{summary.connection.email}</p>
              <small className={summary.connection.status === 'connected' ? 'connection-status' : 'connection-status needs-reconnect'}>
                {summary.connection.status === 'connected' ? 'Connected · read-only' : 'Reconnect required'}
              </small>
              {summary.connection.lastSyncAt && <small>Last sync: {financeDate(summary.connection.lastSyncAt, true)}</small>}
            </>
          ) : (
            <p>Connect one Gmail account. Orbis searches for bank and card transaction alerts only.</p>
          )}

          {summary.databaseReady && !summary.loadError && !summary.connection && (
            <Link className="finance-button primary" href="/auth/gmail/start">Connect Gmail</Link>
          )}
          {summary.databaseReady && !summary.loadError && summary.connection?.status === 'reconnect_required' && (
            <Link className="finance-button primary" href="/auth/gmail/start">Reconnect Gmail</Link>
          )}
          {summary.databaseReady && !summary.loadError && summary.connection?.status === 'connected' && (
            <div className="finance-actions">
              <button className="finance-button primary" type="button" disabled={isPending} onClick={sync}>
                {isPending ? 'Syncing…' : 'Sync now'}
              </button>
              <button className="finance-button secondary" type="button" disabled={isPending} onClick={disconnect}>Disconnect</button>
            </div>
          )}
          <small className="privacy-note">Read-only permission. Orbis does not send, edit, or delete email.</small>
        </div>
      </section>

      {notice && (
        <div className={`finance-notice ${notice === 'connected' ? 'success' : 'error'}`} role="status">
          <span>{notice === 'connected' ? 'Gmail connected.' : notice === 'cancelled' ? 'Gmail connection was cancelled.' : notice === 'setup-error' ? 'Gmail setup is incomplete. Check the Google OAuth credentials and add the local callback URL in Google Cloud.' : 'Gmail could not be connected. Check the setup and try again.'}</span>
          <button type="button" onClick={clearNotice} aria-label="Dismiss message">×</button>
        </div>
      )}
      {actionMessage && <p className={`finance-notice ${actionMessage.success ? 'success' : 'error'}`} role="status">{actionMessage.text}</p>}

      {summary.connection && summary.databaseReady && !summary.loadError && (
        <div className="finance-candidate-summary">
          <strong>{summary.pendingCandidateCount}</strong>
          <span>{summary.pendingCandidateCount === 1 ? 'candidate alert email saved' : 'candidate alert emails saved'}</span>
          <small>Alerts are not counted as expenses until you review and confirm the transaction details.</small>
        </div>
      )}
      {summary.connection && summary.databaseReady && !summary.loadError && (
        <GmailReviewQueue candidates={summary.reviewCandidates} unparsedCount={summary.unparsedCandidateCount} />
      )}

      <SectionTitle title="Saved transactions" action="" />
      {summary.transactions.length ? (
        <div className="stack-card finance-transactions">
          {summary.transactions.map((transaction) => (
            <div className="finance-transaction" key={transaction.id}>
              <div><strong>{transaction.merchant || transaction.category || 'Transaction'}</strong><small>{financeDate(transaction.occurredAt)}</small></div>
              <strong>{transaction.direction === 'income' ? '+' : '−'}{money(transaction.amount, transaction.currency)}</strong>
            </div>
          ))}
        </div>
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
          <p>Transaction alerts are parsed only when you request it, and never count as expenses until you confirm them.</p>
        </div>
      )}
    </div>
  );
}

function HealthScreen() {
  return (
    <div className="screen-body">
      <header className="page-head"><div><small>ORBIS HEALTH</small><h2>Health</h2></div><button className="icon-btn"><Search size={19} /></button></header>
      <div className="health-intro"><HeartPulse size={18} /><p>Start with a spreadsheet you already have. Orbis will show what it read before sending a summary for advice.</p></div>
      <WorkbookAdvisor />
      <p className="health-disclaimer">Suggestions are informational and aren’t a medical diagnosis.</p>
    </div>
  );
}

function GenericScreen({ tab, goalsSummary, contextNotes }: { tab: Exclude<Tab, 'home' | 'finance' | 'health'>; goalsSummary: GoalsSummary; contextNotes: { ready: boolean; notes: ContextNote[] } }) {
  const content = {
    personal: { title: 'Personal', icon: UserRound, text: 'Your profile, preferences, memory and important life context.' },
    investment: { title: 'Investment', icon: Landmark, text: 'Portfolio tracking and future investment intelligence will live here.' },
    goals: { title: 'Goals', icon: Target, text: 'Turn long-term goals into measurable milestones and daily actions.' },
    habits: { title: 'Habits', icon: CheckCircle2, text: 'Track routines, streaks and behavioral patterns.' },
  }[tab];
  const Icon = content.icon;

  return (
    <div className="screen-body">
      <header className="page-head"><div><small>ORBIS</small><h2>{content.title}</h2></div><button className="icon-btn"><Search size={19}/></button></header>
      <div className="feature-hero"><div className="feature-icon"><Icon size={28}/></div><h3>{content.title}</h3><p>{content.text}</p></div>
      {tab === 'habits' && <GoalsHabits kind="habits" data={goalsSummary} />}
      {tab === 'goals' && <GoalsHabits kind="goals" data={goalsSummary} />}
      {tab === 'personal' && <ContextNotes ready={contextNotes.ready} notes={contextNotes.notes} />}
      {tab === 'investment' && <div className="empty-state"><Sparkles size={22}/><strong>Investment tracking is planned</strong><p>Connect a data source before Orbis shows investment information here.</p></div>}
    </div>
  );
}

export default function OrbisApp({ financeSummary, goalsSummary, contextNotes }: { financeSummary: FinanceSummary; goalsSummary: GoalsSummary; contextNotes: { ready: boolean; notes: ContextNote[] } }) {
  const [tab, setTab] = useState<Tab>('home');
  const [gmailNotice, setGmailNotice] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const requestedTab = url.searchParams.get('tab');
    const notice = url.searchParams.get('gmail');
    if (requestedTab === 'finance') setTab('finance');
    if (notice) setGmailNotice(notice);
    if (requestedTab || notice) {
      url.searchParams.delete('tab');
      url.searchParams.delete('gmail');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  const screen = useMemo(() => {
    if (tab === 'home') return <HomeScreen financeSummary={financeSummary} goalsSummary={goalsSummary} openHealth={() => setTab('health')} />;
    if (tab === 'finance') return <FinanceScreen summary={financeSummary} notice={gmailNotice} clearNotice={() => setGmailNotice(null)} />;
    if (tab === 'health') return <HealthScreen />;
    return <GenericScreen tab={tab} goalsSummary={goalsSummary} contextNotes={contextNotes} />;
  }, [contextNotes, financeSummary, gmailNotice, goalsSummary, tab]);

  return (
    <main className="stage">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <section className="intro">
        <div className="logo-mark">O</div>
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
