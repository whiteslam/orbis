'use client';

import type { ReactNode } from 'react';
import { InvestDashboard } from '@/components/money/invest-dashboard';
import type { SavedPortfolioAdvice } from '@/lib/ai/saved';
import type { OwnInvestments } from '@/lib/finance/types';

/** The investments view: the dashboard in its own scroll area. */
export function InvestmentsScreen({ ownInvestments, savedAdvice, notice, clearNotice, switcher }: { ownInvestments: OwnInvestments; savedAdvice: SavedPortfolioAdvice | null; notice: string | null; clearNotice: () => void; switcher?: ReactNode }) {
  return (
    <div className="screen-body field">
      <InvestDashboard ownInvestments={ownInvestments} savedAdvice={savedAdvice} notice={notice} clearNotice={clearNotice} switcher={switcher} />
    </div>
  );
}
