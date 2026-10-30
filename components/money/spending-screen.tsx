'use client';

import { useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { PenLine, Plus } from 'lucide-react';
import { CurrencyCard } from '@/components/money/currency-card';
import { LedgerAmount, TransactionList } from '@/components/money/transaction-list';
import { FieldHead, useScrollTop } from '@/components/field/field';
import { MoneyIn } from '@/components/money/money-in';
import { PartLoading } from '@/components/shell/loading';
import { money } from '@/lib/finance/money';
import type { FinanceSummary } from '@/lib/finance/types';
import type { HeadsupAction } from '@/lib/headsups/types';

const ManualTransactionForm = dynamic(() => import('@/components/money/manual-transaction-form').then((m) => m.ManualTransactionForm), { loading: PartLoading });
const SpendingSummary = dynamic(() => import('@/components/money/spending-summary').then((m) => m.SpendingSummary), { loading: PartLoading });

type FinanceView = 'main' | 'add';

// The ledger opens on the last week or so; the rest is one tap away.
const TRANSACTIONS_SHOWN = 8;

function monthLabel(month: FinanceSummary['month']) {
  return month ? new Date(Date.UTC(month.year, month.month - 1, 1)).toLocaleDateString('en-IN', { month: 'long', timeZone: 'UTC' }) : '';
}

// Nothing saved: the screen is a doorway, not a dashboard.
function isFirstRun(summary: FinanceSummary, ready: boolean) {
  if (!ready || summary.transactions.length) return false;
  const month = summary.month;
  return !(month && (month.spent > 0 || month.received > 0));
}

function emptyListText(summary: FinanceSummary) {
  if (!summary.databaseReady) return 'Saved transactions aren’t available right now.';
  if (summary.loadError) return 'Transactions could not be loaded. Refreshing the app tries again.';
  return 'Nothing saved yet. Add a spend with the Add button and it lands here.';
}

/**
 * The ledger: the latest transactions grouped by day, all of them on request.
 * On the phone it follows the month; on desktop it runs down the right.
 */
function Ledger({ summary, all, onAll }: Readonly<{ summary: FinanceSummary; all: boolean; onAll: (all: boolean) => void }>) {
  const count = summary.transactions.length;
  return (
    <section className="mn-ledger" aria-labelledby="mn-ledger-title">
      <div className="mn-h-row">
        <h2 className="mn-h" id="mn-ledger-title">Transactions{count ? <span className="mn-h-count">{count}</span> : null}</h2>
        {count > TRANSACTIONS_SHOWN && (
          <button className="fd-link" type="button" aria-expanded={all} onClick={() => onAll(!all)}>
            {all ? 'Show less' : `Show all ${count}`}
          </button>
        )}
      </div>
      {count ? (
        <TransactionList transactions={all ? summary.transactions : summary.transactions.slice(0, TRANSACTIONS_SHOWN)} />
      ) : (
        <p className="fd-empty mn-empty">{emptyListText(summary)}</p>
      )}
    </section>
  );
}

export function SpendingScreen({ summary, switcher, intent = null }: Readonly<{ summary: FinanceSummary; switcher?: ReactNode; intent?: HeadsupAction | null }>) {
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
  const monthName = monthLabel(month);
  const dayOfMonth = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', day: 'numeric' }).format(new Date()));
  const firstRun = isFirstRun(summary, ready);

  // addManualTransactionAction has already revalidated '/', so the new row is on its way.
  function saved(message: string) {
    setActionMessage({ text: message, success: true });
    setView('main');
  }

  if (view === 'add') return (
    <div className="screen-body field mn-screen mn-entry-screen">
      <span ref={top} hidden />
      <ManualTransactionForm onClose={() => setView('main')} onSaved={saved} initialCategory={prefill} />
    </div>
  );

  const notices = actionMessage && <output className={`finance-notice spaced ${actionMessage.success ? 'success' : 'error'}`}>{actionMessage.text}</output>;

  if (firstRun) return (
    <div className="screen-body field mn-screen">
      <span ref={top} hidden />
      <FieldHead title="Money" />{switcher}
      {notices}
      <div className="mn mn-first">
        <section className="mn-sheet">
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
        </section>

        <div className="mn-foot">
          <CurrencyCard note="works without any account" />
          <p className="fd-note">Orbis only uses what you enter here. Nothing is inferred about you.</p>
        </div>
      </div>
    </div>
  );

  // The month's pace, carried to its last day: a rate, not a comparison.
  const daysInMonth = month ? new Date(Date.UTC(month.year, month.month, 0)).getUTCDate() : 0;
  const pace = month && month.spent > 0 ? month.spent / Math.max(dayOfMonth, 1) : 0;
  const onPace = month && pace > 0 && dayOfMonth < daysInMonth ? pace * daysInMonth : null;

  return (
    <div className="screen-body field mn-screen">
      <span ref={top} hidden />
      <FieldHead title="Money" />{switcher}
      {notices}

      {/* The page reads as a ledger: the month's figure on one sheet with its
          shape and where it went, then the transactions by day. What came in
          and the rates follow; on desktop the ledger runs down the right. */}
      <div className="mn">
        {ready && (
          <section className="mn-sheet" aria-label={monthName ? `Spending in ${monthName}` : 'Spending'}>
            {/* Manual entry is the only way in, so it is the page's one primary button. */}
            <div className="mn-lead">
              {monthReady && month ? (
                <p className="mn-figure">
                  <span className="mn-figure-cap">Spent in {monthName}</span>
                  <span className="mn-figure-value"><LedgerAmount amount={month.spent} currency={month.currency} /></span>
                </p>
              ) : <p className="mn-figure"><span className="mn-figure-cap">This month</span></p>}
              <button className="mn-add" type="button" onClick={() => setView('add')} aria-label="Add manually"><Plus size={16} strokeWidth={2.4} aria-hidden="true" />Add</button>
            </div>
            {monthReady && month && month.spent > 0 && (
              <p className="mn-pace" suppressHydrationWarning>
                <span className="fd-delta flat">{money(pace, month.currency)} a day</span>
                {onPace !== null && <span>On pace for {money(onPace, month.currency)} by {daysInMonth} {monthName}</span>}
              </p>
            )}
            {month && <SpendingSummary month={month} highlight={highlight} incomeShown={incomeShown} />}
          </section>
        )}

        <Ledger summary={summary} all={allTransactions} onAll={setAllTransactions} />

        {ready && (
          <section className="mn-in" aria-label="Money in">
            <MoneyIn summary={summary} shown={incomeShown} onShown={setIncomeShown} />
          </section>
        )}

        <div className="mn-foot">
          <CurrencyCard />
        </div>
      </div>
    </div>
  );
}
