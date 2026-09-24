'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { loadInvestLiveAction } from '@/app/invest/actions';
import { analysePortfolio } from '@/lib/invest/analysis';
import type { InvestmentSummary, LivePortfolioData } from '@/lib/invest/types';
import { GrowwPortfolio } from '@/components/invest/groww-portfolio';
import { InvestmentHoldings } from '@/components/invest/investment-holdings';
import { PortfolioAi } from '@/components/invest/portfolio-ai';
import { AllocationCharts, GrowthProjector, PortfolioIndicators } from '@/components/invest/portfolio-charts';
import { inr, percent, signedInr } from '@/components/invest/format';

export function InvestDashboard({ summary, goalCount }: { summary: InvestmentSummary; goalCount: number }) {
  const [live, setLive] = useState<LivePortfolioData | null>(null);
  const [isLoading, startTransition] = useTransition();

  function load() {
    startTransition(async () => setLive(await loadInvestLiveAction()));
  }

  // Reload when holdings change (add, edit, delete) so live prices follow.
  useEffect(load, [summary.holdings]);

  const groww = live?.groww ?? null;
  const growwHoldings = useMemo(() => (groww?.state === 'ok' ? groww.holdings : []), [groww]);
  const analysis = useMemo(
    () => analysePortfolio(growwHoldings, summary.holdings, { manualPrices: live?.manualPrices, fxToInr: live?.fxToInr }),
    [growwHoldings, live, summary.holdings],
  );
  const hasData = analysis.positions.length > 0;

  return (
    <>
      <section className="invest-hero">
        <small>TOTAL PORTFOLIO</small>
        <strong>{!live && !hasData ? '…' : inr(analysis.total)}</strong>
        <div className="invest-hero-meta">
          {analysis.livePnl !== null && analysis.liveInvested > 0 ? (
            <span className={analysis.livePnl >= 0 ? 'up' : 'down'}>{signedInr(analysis.livePnl)} ({analysis.livePnl >= 0 ? '+' : '−'}{percent(Math.abs(analysis.livePnl / analysis.liveInvested))})</span>
          ) : (
            <span>{live ? 'At entered values' : 'Fetching prices…'}</span>
          )}
          <span>{analysis.positions.length} {analysis.positions.length === 1 ? 'holding' : 'holdings'}</span>
          {analysis.byClass[0] && <span>Mostly {analysis.byClass.slice().sort((left, right) => right.value - left.value)[0].assetClass}</span>}
        </div>
        {hasData && !analysis.allLive && live && <p>Some holdings have no live price, so they count at invested or entered value.</p>}
        {analysis.excludedCurrencies.length > 0 && <p>Holdings in {analysis.excludedCurrencies.join(', ')} are listed below but not in this INR total, because no exchange rate was available.</p>}
      </section>

      {live?.notices.map((notice) => <p className="finance-notice error" role="status" key={notice}>{notice}</p>)}

      {hasData && <PortfolioIndicators analysis={analysis} />}
      {hasData && <AllocationCharts analysis={analysis} />}
      <GrowwPortfolio portfolio={groww} isLoading={isLoading} onRefresh={load} />
      {hasData && <PortfolioAi goalCount={goalCount} hasGroww={growwHoldings.length > 0} />}
      <GrowthProjector startValue={analysis.total} />
      <InvestmentHoldings summary={summary} livePrices={live?.manualPrices ?? {}} />
    </>
  );
}
