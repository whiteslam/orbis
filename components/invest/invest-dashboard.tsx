'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { loadInvestLiveAction } from '@/app/invest/actions';
import { analysePortfolio } from '@/lib/invest/analysis';
import { BROKERS, brokerMeta, type BrokerId } from '@/lib/invest/brokers';
import type { LivePortfolioData } from '@/lib/invest/types';
import { BrokerCard, BrokerConnectScreen } from '@/components/invest/broker-card';
import { PortfolioAi, PortfolioAiRow } from '@/components/invest/portfolio-ai';
import { AllocationBreakdown, PortfolioHealth } from '@/components/invest/portfolio-charts';

import { safeAction } from '@/lib/client/safe-action';
import type { SavedPortfolioAdvice } from '@/lib/ai/saved';
import { composeInvestFocus, composeInvestRows } from '@/lib/focus/invest';
import { FieldHead, FieldHero, FieldLabel, FocusSurface, QuietList, useScrollTop } from '@/components/field/field';
import { inr } from '@/components/invest/format';

type InvestView = { name: 'main' } | { name: 'connect'; broker: BrokerId; reconnect: boolean } | { name: 'advice' };

/**
 * Reading order, worst-first as the audit found it: the screen used to open on
 * a statement and then spend four sections analysing holdings the user had not
 * been shown yet, with the connect form last. Now it runs statement → numbers →
 * shape → the accounts themselves → suggestions, and when nothing is connected
 * the analysis sections drop out. Connecting and suggestions each open their
 * own view rather than unfolding a form in the middle of the screen.
 */
export function InvestDashboard({ goalCount, savedAdvice }: { goalCount: number; savedAdvice: SavedPortfolioAdvice | null }) {
  const [live, setLive] = useState<LivePortfolioData | null>(null);
  const [isLoading, startTransition] = useTransition();
  const [view, setView] = useState<InvestView>({ name: 'main' });
  const [advice, setAdvice] = useState<SavedPortfolioAdvice | null>(savedAdvice);
  const top = useScrollTop(view.name === 'connect' ? `connect-${view.broker}` : view.name);

  function load() {
    startTransition(async () => setLive(await safeAction(loadInvestLiveAction, () => null)()));
  }

  useEffect(load, []);

  const analysis = useMemo(() => analysePortfolio(live?.brokers ?? []), [live]);
  const hasData = analysis.positions.length > 0;
  const failures = (live?.brokers ?? [])
    .filter((broker) => broker.state === 'error')
    .map((broker) => ({ name: brokerMeta(broker.broker).name, message: broker.message ?? 'The connection failed.' }));
  const connected = (live?.brokers ?? []).some((broker) => broker.state !== 'not_connected');
  const portfolioOf = (id: BrokerId) => live?.brokers.find((broker) => broker.broker === id) ?? null;

  if (view.name === 'connect') {
    const meta = brokerMeta(view.broker);
    const portfolio = portfolioOf(view.broker);
    return (
      <>
        <span ref={top} hidden />
        <BrokerConnectScreen
          meta={meta}
          reconnect={view.reconnect}
          setupMessage={portfolio?.state === 'not_connected' && portfolio.setupRequired ? portfolio.message : undefined}
          others={BROKERS.filter((other) => other.id !== meta.id).map((other) => ({ meta: other, connected: portfolioOf(other.id)?.state !== 'not_connected' }))}
          onBack={() => setView({ name: 'main' })}
          onOpen={(broker) => setView({ name: 'connect', broker, reconnect: false })}
          onConnected={() => { setView({ name: 'main' }); load(); }}
        />
      </>
    );
  }

  if (view.name === 'advice') {
    return (
      <>
        <span ref={top} hidden />
        <PortfolioAi goalCount={goalCount} advice={advice} setAdvice={setAdvice} onBack={() => setView({ name: 'main' })} />
      </>
    );
  }

  const focus = composeInvestFocus({
    analysis,
    loaded: Boolean(live),
    failures,
    connected,
    savedAdviceAt: advice?.createdAt ?? null,
  });

  // Atlas leads on the figure; the composed statement below it deliberately
  // spends its words on what the figure does not say. Gain is only shown where
  // every contributing position had a live price, which is what livePnl means.
  const gain = analysis.livePnl !== null && analysis.liveInvested > 0
    ? { text: `${analysis.livePnl >= 0 ? '+' : '−'}${inr(Math.abs(analysis.livePnl))} · ${Math.abs((analysis.livePnl / analysis.liveInvested) * 100).toFixed(1)}%`, tone: analysis.livePnl >= 0 ? 'up' as const : 'down' as const }
    : null;

  return (
    <>
      <span ref={top} hidden />
      <FieldHead title="Invest" />
      {hasData && (
        <FieldHero
          value={inr(analysis.total)}
          label={analysis.positions.length === 1 ? 'in 1 holding' : `across ${analysis.positions.length} holdings`}
          delta={gain}
        />
      )}

      <FocusSurface focus={focus} />

      {/* Six rows of dashes tell a new user nothing, so the numbers wait until there are numbers. */}
      {hasData && <QuietList heading="Position" rows={composeInvestRows({ analysis })} />}

      {hasData && <><FieldLabel>Health of the mix</FieldLabel><PortfolioHealth analysis={analysis} /></>}
      {hasData && <><FieldLabel>Allocation</FieldLabel><AllocationBreakdown analysis={analysis} /></>}

      <FieldLabel>Accounts</FieldLabel>
      {BROKERS.map((meta) => (
        <BrokerCard
          key={meta.id}
          meta={meta}
          portfolio={portfolioOf(meta.id)}
          isLoading={isLoading}
          onRefresh={load}
          onConnect={(reconnect) => setView({ name: 'connect', broker: meta.id, reconnect })}
        />
      ))}

      {hasData && <PortfolioAiRow advice={advice} onOpen={() => setView({ name: 'advice' })} />}
    </>
  );
}
