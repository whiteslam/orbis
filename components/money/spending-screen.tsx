'use client';

import { useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { PenLine, Plus } from 'lucide-react';
import { CurrencyCard } from '@/components/money/currency-card';
import { TransactionList } from '@/components/money/transaction-list';
import { FieldHead, FieldHero, FieldLabel, useScrollTop } from '@/components/field/field';
import { MoneyIn } from '@/components/money/money-in';
import { PartLoading } from '@/components/shell/loading';
import { money } from '@/lib/finance/money';
import type { FinanceSummary } from '@/lib/finance/types';
import type { HeadsupAction } from '@/lib/headsups/types';

const ManualTransactionForm = dynamic(() => import('@/components/money/manual-transaction-form').then((m) => m.ManualTransactionForm), { loading: PartLoading });
const SpendingSummary = dynamic(() => import('@/components/money/spending-summary').then((m) => m.SpendingSummary), { loading: PartLoading });

type FinanceView = 'main' | 'add';

// The list sits at the foot of the tab and opens short; the rest is one tap away.
const TRANSACTIONS_SHOWN = 3;

export function SpendingScreen({ summary, switcher, intent = null }: { summary: FinanceSummary; switcher?: ReactNode; intent?: HeadsupAction | null }) {
  // A heads-up can open this ready to add a spend, or pointing at one category.
  const [view, setView] = useState<FinanceView>(() => intent?.type === 'open_spending_entry' ? 'add' : 'main');
  const prefill = intent?.type === 'open_spending_entry' ? intent.category : undefined;
  const highlight = intent?.type === 'review_category' ? intent.category : null;
  const [actionMessage, setActionMessage] = useState<{ text: string; success: boolean } | null>(null);
  // What you earn stays covered until you ask for it, and is covered again the
  // next time the app opens: the phone is often in view of someone else.
  const [incomeShown, setIncomeShown] = useState(false);
  const [allTransactions, setAllTransactions] = useState(false);
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
      <ManualTransactionForm onClose={() => setView('main')} onSaved={saved} initialCategory={prefill} />
    </div>
  );

  const notices = actionMessage && <p className={`finance-notice ${actionMessage.success ? 'success' : 'error'}`} role="status">{actionMessage.text}</p>;

  if (firstRun) return (
    <div className="screen-body field">
      <span ref={top} hidden />
      <FieldHead title="Money" />{switcher}
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
      <FieldHead title="Money" />{switcher}
      {/* Manual entry is the only way in, so it stays at the top — as a small
          button beside the month's total rather than a row of its own. */}
      <div className="mn-top">
        {monthReady && month && month.spent > 0 && (
          <FieldHero
            value={money(month.spent, month.currency)}
            label={`spent in ${monthName}`}
            delta={{ text: `${money(month.spent / Math.max(dayOfMonth, 1), month.currency)} a day`, tone: 'flat' }}
          />
        )}
        {ready && <button className="mn-add" type="button" onClick={() => setView('add')} aria-label="Add manually"><Plus size={14} strokeWidth={2.4} aria-hidden="true" />Add</button>}
      </div>

      {notices}

      {/* The tab reads top to bottom as: the month, what came in, rates, then
          the transactions themselves. Each is one card, as on Health; the two
          reference blocks at the foot open on demand so they cost a line each. */}
      {summary.month && ready && (
        <section className="mn-card" aria-label={`Spending in ${monthName}`}>
          <SpendingSummary month={summary.month} highlight={highlight} incomeShown={incomeShown} />
        </section>
      )}

      {ready && (
        <section className="mn-card" aria-label="Money in">
          <MoneyIn summary={summary} shown={incomeShown} onShown={setIncomeShown} />
        </section>
      )}

      <CurrencyCard />

      <div className="fd-label-row">
        <FieldLabel>Latest{summary.transactions.length ? ` · ${summary.transactions.length}` : ''}</FieldLabel>
        {summary.transactions.length > TRANSACTIONS_SHOWN && (
          <button className="fd-link" type="button" aria-expanded={allTransactions} onClick={() => setAllTransactions(!allTransactions)}>
            {allTransactions ? 'Show less' : `Show all ${summary.transactions.length}`}
          </button>
        )}
      </div>
      {summary.transactions.length ? (
        <TransactionList transactions={allTransactions ? summary.transactions : summary.transactions.slice(0, TRANSACTIONS_SHOWN)} />
      ) : (
        <p className="fd-empty">
          {!summary.databaseReady
            ? 'Saved transactions aren’t available right now.'
            : summary.loadError
              ? 'Transactions could not be loaded. Refreshing the app tries again.'
              : 'Nothing saved yet.'}
        </p>
      )}
    </div>
  );
}
