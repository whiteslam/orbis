'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { loadInvestLiveAction } from '@/app/invest/actions';
import { analysePortfolio } from '@/lib/invest/analysis';
import { BROKERS, brokerMeta } from '@/lib/invest/brokers';
import type { LivePortfolioData } from '@/lib/invest/types';
import { BrokerCard } from '@/components/invest/broker-card';
import { PortfolioAi } from '@/components/invest/portfolio-ai';
import { AllocationBreakdown, PortfolioHealth } from '@/components/invest/portfolio-charts';

import { safeAction } from '@/lib/client/safe-action';
import type { SavedPortfolioAdvice } from '@/lib/ai/saved';
import { composeInvestFocus, composeInvestRows } from '@/lib/focus/invest';
import { FieldLabel, FocusSurface, QuietList } from '@/components/field/field';

/**
 * Reading order, worst-first as the audit found it: the screen used to open on
 * a statement and then spend four sections analysing holdings the user had not
 * been shown yet, with the connect form last. Now it runs statement → numbers →
 * shape → the accounts themselves → suggestions, and when nothing is connected
 * the analysis sections drop out, so the connect form sits directly under the
 * opening line instead of below everything else.
 */
export function InvestDashboard({ goalCount, savedAdvice }: { goalCount: number; savedAdvice: SavedPortfolioAdvice | null }) {
  const [live, setLive] = useState<LivePortfolioData | null>(null);
  const [isLoading, startTransition] = useTransition();

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

  const focus = composeInvestFocus({
    analysis,
    loaded: Boolean(live),
    failures,
    connected,
    savedAdviceAt: savedAdvice?.createdAt ?? null,
  });

  return (
    <>
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
          portfolio={live?.brokers.find((broker) => broker.broker === meta.id) ?? null}
          isLoading={isLoading}
          onRefresh={load}
        />
      ))}

      {hasData && <><FieldLabel>Suggestions</FieldLabel><PortfolioAi goalCount={goalCount} saved={savedAdvice} /></>}
    </>
  );
}
