'use client';

import dynamic from 'next/dynamic';
import { TabLoading } from '@/components/shell/loading';
import type { SavedPortfolioAdvice } from '@/lib/ai/saved';
import type { FinanceSummary } from '@/lib/finance/types';
import type { MoneyView } from '@/lib/shell/tabs';

const SpendingScreen = dynamic(() => import('@/components/money/spending-screen').then((m) => m.SpendingScreen), { loading: TabLoading });
const InvestmentsScreen = dynamic(() => import('@/components/money/investments-screen').then((m) => m.InvestmentsScreen), { loading: TabLoading });

/** Spending | Investments, drawn under the Money title by whichever view is open. */
export function MoneySwitch({ view, onView }: { view: MoneyView; onView: (view: MoneyView) => void }) {
  return (
    <div className="fd-tabs" role="tablist" aria-label="Money">
      <button type="button" role="tab" aria-selected={view === 'spending'} onClick={() => onView('spending')}>Spending</button>
      <button type="button" role="tab" aria-selected={view === 'investments'} onClick={() => onView('investments')}>Investments</button>
    </div>
  );
}

export function MoneyScreen({ view, onView, summary, savedPortfolioAdvice, brokerNotice, clearBrokerNotice }: {
  view: MoneyView;
  onView: (view: MoneyView) => void;
  summary: FinanceSummary;
  savedPortfolioAdvice: SavedPortfolioAdvice | null;
  brokerNotice: string | null;
  clearBrokerNotice: () => void;
}) {
  const switcher = <MoneySwitch view={view} onView={onView} />;
  return view === 'spending'
    ? <SpendingScreen summary={summary} switcher={switcher} />
    : <InvestmentsScreen savedAdvice={savedPortfolioAdvice} notice={brokerNotice} clearNotice={clearBrokerNotice} switcher={switcher} />;
}
