'use client';

import type { ReactNode } from 'react';
import { InvestDashboard } from '@/components/money/invest-dashboard';
import type { SavedPortfolioAdvice } from '@/lib/ai/saved';

/** The investments view: the dashboard in its own scroll area. */
export function InvestmentsScreen({ savedAdvice, notice, clearNotice, switcher }: { savedAdvice: SavedPortfolioAdvice | null; notice: string | null; clearNotice: () => void; switcher?: ReactNode }) {
  return (
    <div className="screen-body field">
      <InvestDashboard savedAdvice={savedAdvice} notice={notice} clearNotice={clearNotice} switcher={switcher} />
    </div>
  );
}
