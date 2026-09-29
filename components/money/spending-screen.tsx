'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { PenLine } from 'lucide-react';
import { CurrencyCard } from '@/components/money/currency-card';
import { TransactionList } from '@/components/money/transaction-list';
import { FieldHead, FieldHero, FieldLabel, useScrollTop } from '@/components/field/field';
import { PartLoading } from '@/components/shell/loading';
import { money } from '@/lib/finance/money';
import type { FinanceSummary } from '@/lib/finance/types';

const ManualTransactionForm = dynamic(() => import('@/components/money/manual-transaction-form').then((m) => m.ManualTransactionForm), { loading: PartLoading });
const SpendingSummary = dynamic(() => import('@/components/money/spending-summary').then((m) => m.SpendingSummary), { loading: PartLoading });

type FinanceView = 'main' | 'add';

export function SpendingScreen({ summary }: { summary: FinanceSummary }) {
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
