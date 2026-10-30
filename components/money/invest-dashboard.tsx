'use client';

import { useEffect, useMemo, useState, useTransition, type ReactNode } from 'react';
import { loadInvestLiveAction } from '@/app/invest/actions';
import { analysePortfolio, type PortfolioAnalysis } from '@/lib/invest/analysis';
import { BROKERS, brokerMeta, type BrokerId } from '@/lib/invest/brokers';
import type { LivePortfolioData } from '@/lib/invest/types';
import { BrokerCard, BrokerConnectScreen } from '@/components/money/broker-card';
import { PortfolioAi, PortfolioAiRow } from '@/components/money/portfolio-ai';
import { AllocationBreakdown, PortfolioHealth } from '@/components/money/portfolio-charts';

import { safeAction } from '@/lib/client/safe-action';
import type { SavedPortfolioAdvice } from '@/lib/ai/saved';
import type { OwnInvestments } from '@/lib/finance/types';
import { OwnInvestmentsList } from '@/components/money/own-investments';
import { PortfolioNewsCard } from '@/components/money/portfolio-news';
import { ResearchDeskSection } from '@/components/research/research-desk';
import { composeInvestFocus, composeInvestRows } from '@/lib/focus/invest';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { FieldHead, FocusSurface, QuietList, useScrollTop } from '@/components/field/field';
import { inr } from '@/components/money/format';
import { LedgerAmount } from '@/components/money/transaction-list';

type InvestView = { name: 'main' } | { name: 'connect'; broker: BrokerId; reconnect: boolean } | { name: 'advice' };

/**
 * Reading order, worst-first as the audit found it: the screen used to open on
 * a statement and then spend four sections analysing holdings the user had not
 * been shown yet, with the connect form last. Now it runs statement → numbers →
 * shape → the accounts themselves → suggestions, and when nothing is connected
 * the analysis sections drop out. Connecting and suggestions each open their
 * own view rather than unfolding a form in the middle of the screen.
 */
// What /auth/zerodha/callback reports back through ?zerodha=.
const ZERODHA_NOTICE: Record<string, string> = {
  connected: 'Zerodha connected. Holdings are loading below.',
  cancelled: 'Zerodha login was cancelled.',
  rejected: 'Zerodha didn’t accept that login. Try connecting again.',
  expired: 'That Zerodha login took too long or started on a different address. Connect again from here.',
  'not-configured': 'Zerodha can’t be connected on this server yet.',
  failed: 'Zerodha could not be connected. Try again.',
};

// Atlas leads on the figure; the composed statement below it deliberately
// spends its words on what the figure does not say. Gain is only shown where
// every contributing position had a live price, which is what livePnl means.
function gainDelta(analysis: PortfolioAnalysis) {
  if (analysis.livePnl !== null && analysis.liveInvested > 0) {
    return { text: `${analysis.livePnl >= 0 ? '+' : '−'}${inr(Math.abs(analysis.livePnl))} · ${Math.abs((analysis.livePnl / analysis.liveInvested) * 100).toFixed(1)}%`, tone: analysis.livePnl >= 0 ? 'up' as const : 'down' as const };
  }
  return null;
}

export function InvestDashboard({ ownInvestments, savedAdvice, notice, clearNotice, switcher }: Readonly<{ ownInvestments?: OwnInvestments; savedAdvice: SavedPortfolioAdvice | null; notice?: string | null; clearNotice?: () => void; switcher?: ReactNode }>) {
  const [live, setLive] = useState<LivePortfolioData | null>(null);
  const [isLoading, startTransition] = useTransition();
  const [view, setView] = useState<InvestView>({ name: 'main' });
  const [advice, setAdvice] = useState<SavedPortfolioAdvice | null>(savedAdvice);
  const top = useScrollTop(view.name === 'connect' ? `connect-${view.broker}` : view.name);

  function load() {
    startTransition(async () => setLive(await safeAction(loadInvestLiveAction, () => null)()));
  }

  useEffect(load, []);

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
        <PortfolioAi advice={advice} setAdvice={setAdvice} onBack={() => setView({ name: 'main' })} />
      </>
    );
  }

  return (
    <>
      <span ref={top} hidden />
      <InvestMain
        live={live}
        isLoading={isLoading}
        onRefresh={load}
        advice={advice}
        ownInvestments={ownInvestments}
        notice={notice}
        clearNotice={clearNotice}
        switcher={switcher}
        onConnect={(broker, reconnect) => setView({ name: 'connect', broker, reconnect })}
        onAdvice={() => setView({ name: 'advice' })}
      />
    </>
  );
}

// The headline of these two only restates the figure above it, so the sheet keeps their sentence alone.
const FIGURE_FOCUS = new Set(['live-position', 'cost-basis']);

/**
 * The main Investments view, drawn from one load of the accounts. The value
 * leads on the sheet with what it means; the holdings follow as rows grouped
 * by account; the shape of the mix, the news and suggestions close it.
 */
export function InvestMain({ live, isLoading, onRefresh, advice, ownInvestments, notice, clearNotice, switcher, onConnect, onAdvice }: Readonly<{
  live: LivePortfolioData | null;
  isLoading: boolean;
  onRefresh: () => void;
  advice: SavedPortfolioAdvice | null;
  ownInvestments?: OwnInvestments;
  notice?: string | null;
  clearNotice?: () => void;
  switcher?: ReactNode;
  onConnect: (broker: BrokerId, reconnect: boolean) => void;
  onAdvice: () => void;
}>) {
  const analysis = useMemo(() => analysePortfolio(live?.brokers ?? []), [live]);
  const hasData = analysis.positions.length > 0;
  const failures = (live?.brokers ?? [])
    .filter((broker) => broker.state === 'error')
    .map((broker) => ({ name: brokerMeta(broker.broker).name, message: broker.message ?? 'The connection failed.' }));
  const connected = (live?.brokers ?? []).some((broker) => broker.state !== 'not_connected');
  const portfolioOf = (id: BrokerId) => live?.brokers.find((broker) => broker.broker === id) ?? null;

  const focus = composeInvestFocus({
    analysis,
    loaded: Boolean(live),
    failures,
    connected,
    savedAdviceAt: advice?.createdAt ?? null,
  });

  const gain = gainDelta(analysis);

  return (
    <>
      <FieldHead title="Money" />{switcher}

      {notice && (
        <output className={`finance-notice ${notice === 'connected' ? 'success' : 'error'}`}>
          <span>{ZERODHA_NOTICE[notice] ?? ZERODHA_NOTICE.failed}</span>
          <button type="button" onClick={clearNotice} aria-label="Dismiss message">×</button>
        </output>
      )}

      <div className="mn mn-invest">
        <section className="mn-sheet" aria-label="Portfolio">
          {hasData && (
            <div className="mn-lead">
              <p className="mn-figure">
                <span className="mn-figure-cap">{analysis.positions.length === 1 ? 'Worth today, in 1 holding' : `Worth today, across ${analysis.positions.length} holdings`}</span>
                <span className="mn-figure-value"><LedgerAmount amount={analysis.total} currency="INR" /></span>
              </p>
            </div>
          )}
          {hasData && gain && (
            <p className="mn-pace">
              <span className={`fd-delta ${gain.tone}`}>
                {gain.tone === 'up' ? <ArrowUp size={10} strokeWidth={2.8} aria-hidden="true" /> : <ArrowDown size={10} strokeWidth={2.8} aria-hidden="true" />}
                {gain.text}
              </span>
              <span>on what you paid</span>
            </p>
          )}
          {hasData && FIGURE_FOCUS.has(focus.id)
            ? <p className="mn-statement" suppressHydrationWarning>{focus.body}</p>
            : <FocusSurface focus={focus} />}

          {/* Six rows of dashes tell a new user nothing, so the numbers wait until there are numbers. */}
          {hasData && <QuietList heading="Position" rows={composeInvestRows({ analysis })} />}
        </section>

        <section className="mn-ledger mn-holdings" aria-labelledby="mn-holdings-title">
          <div className="mn-h-row">
            <h2 className="mn-h" id="mn-holdings-title">{hasData ? 'Holdings' : 'Accounts'}</h2>
          </div>
          <div className="pf-group mn-accounts">
            {BROKERS.map((meta) => (
              <BrokerCard
                key={meta.id}
                meta={meta}
                portfolio={portfolioOf(meta.id)}
                isLoading={isLoading}
                onRefresh={onRefresh}
                onConnect={(reconnect) => onConnect(meta.id, reconnect)}
              />
            ))}
          </div>
        </section>

        <div className="mn-side">
          {/* Waits for the broker load, so it is asked once with the holdings known. */}
          {live && (hasData || Boolean(ownInvestments?.categories.length)) && <PortfolioNewsCard />}

          {hasData && <PortfolioAiRow advice={advice} onOpen={onAdvice} />}

          {hasData && (
            <section className="mn-mix" aria-labelledby="mn-mix-title">
              <h2 className="mn-h" id="mn-mix-title">Health of the mix</h2>
              <PortfolioHealth analysis={analysis} />
              <h3 className="mn-sub">Allocation</h3>
              <AllocationBreakdown analysis={analysis} />
            </section>
          )}

          {ownInvestments && <OwnInvestmentsList own={ownInvestments} />}

          {/* Owner only: renders nothing for anyone the Research desk isn't for. */}
          {live && <ResearchDeskSection brokers={live.brokers} />}
        </div>
      </div>
    </>
  );
}
