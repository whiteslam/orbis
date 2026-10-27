'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { ArrowUpRight, LoaderCircle, ScanSearch } from 'lucide-react';
import { startResearchAction } from '@/app/research/actions';
import { RatingChip, TrackRecordLine } from '@/components/research/decision-card';
import { RunView, StatusChip } from '@/components/research/run-view';
import { useResearchDesk } from '@/components/research/use-research';
import { FieldLabel } from '@/components/field/field';
import { safeAction } from '@/lib/client/safe-action';
import { brokerMeta } from '@/lib/invest/brokers';
import type { BrokerPortfolio } from '@/lib/invest/types';
import { deskHoldings } from '@/lib/research/context';
import { ACTIVE_STATUSES, FUND_UNSUPPORTED, RESEARCH_DISCLAIMER, type ResearchRun } from '@/lib/research/types';

const RECENT = 5;

/**
 * The Research desk in Money → Investments, for the owner only: Deep analysis
 * on any stock or ETF held, or on any NSE/BSE ticker typed, the latest runs,
 * and how past calls did. For anyone else the action answers null and this
 * renders nothing. `brokers` is what the Investments screen already loaded.
 */
export function ResearchDeskSection({ brokers }: Readonly<{ brokers: BrokerPortfolio[] }>) {
  const { desk, problem, reload } = useResearchDesk();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const holdings = useMemo(() => deskHoldings(brokers), [brokers]);

  if (desk === false) return null;
  if (desk === null) {
    return problem ? <p className="fd-weather-quiet">{problem}</p> : null;
  }

  const activeByTicker = new Map(desk.runs.filter((run) => ACTIVE_STATUSES.includes(run.status)).map((run) => [run.ticker, run]));
  const latestByTicker = new Map<string, ResearchRun>();
  for (const run of desk.runs) if (!latestByTicker.has(run.ticker)) latestByTicker.set(run.ticker, run);

  const start = async (key: string, input: { holdingKey: string } | { ticker: string }) => {
    setBusy(key);
    setMessage(null);
    const result = await safeAction(startResearchAction)(input);
    setBusy(null);
    if (!result.success) return setMessage(result.message);
    setTyped('');
    setOpen(result.data.runId);
    reload();
  };

  if (open) {
    return (
      <>
        <FieldLabel>Research desk</FieldLabel>
        <RunView
          runId={open}
          settlements={desk.settlements}
          onBack={() => { setOpen(null); reload(); }}
          onRetry={(run) => void start(`retry-${run.id}`, { ticker: run.ticker })}
        />
      </>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (typed.trim()) void start('typed', { ticker: typed });
  };

  // Each ticker once: two brokers holding the same stock is one analysis.
  const seen = new Set<string>();
  const rows = holdings.filter((holding) => {
    const id = holding.target.ok ? holding.target.ticker : holding.key;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return (
    <>
      <FieldLabel>Research desk</FieldLabel>
      <section className="rd-desk" aria-label="Research desk">
        <p className="rd-lead">A team of AI agents researches one stock, debates it and ends in a call with its reasons. Only you can see this.</p>
        <TrackRecordLine settlements={desk.settlements} />
        {!desk.configured && <p className="fd-hint">The research worker isn’t set up on this server yet, so runs can’t start.</p>}

        {rows.length > 0 && (
          <ul className="rd-holdings">
            {rows.map((holding) => {
              const target = holding.target;
              const active = target.ok ? activeByTicker.get(target.ticker) : undefined;
              const latest = target.ok ? latestByTicker.get(target.ticker) : undefined;
              return (
                <li key={holding.key} className="rd-holding">
                  <div className="rd-holding-name">
                    <b>{holding.symbol}</b>
                    <span>{brokerMeta(holding.broker).name} · {holding.assetClass}</span>
                  </div>
                  {!target.ok && <span className="rd-unsupported">{target.reason === 'fund' ? FUND_UNSUPPORTED : 'Not an NSE or BSE listing'}</span>}
                  {target.ok && latest?.decision && !active && (
                    <button type="button" className="rd-latest" onClick={() => setOpen(latest.id)} aria-label={`Open the last call on ${holding.symbol}`}>
                      <RatingChip rating={latest.decision.rating} />
                    </button>
                  )}
                  {target.ok && active && (
                    <button type="button" className="rd-latest" onClick={() => setOpen(active.id)} aria-label={`Open the run on ${holding.symbol}`}>
                      <StatusChip status={active.status} />
                    </button>
                  )}
                  {target.ok && !active && (
                    <button type="button" className="cr-btn" onClick={() => void start(holding.key, { holdingKey: holding.key })} disabled={busy !== null || !desk.configured}>
                      {busy === holding.key ? <LoaderCircle className="workbook-spinner" size={14} aria-hidden="true" /> : <ScanSearch size={14} aria-hidden="true" />}
                      Deep analysis
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <form className="rd-typed" onSubmit={submit}>
          <label htmlFor="rd-ticker">Any NSE or BSE ticker</label>
          <div>
            <input id="rd-ticker" value={typed} onChange={(event) => setTyped(event.currentTarget.value)} placeholder="RELIANCE, NSE:INFY, BSE:500325" maxLength={40} autoComplete="off" spellCheck={false} />
            <button type="submit" className="cr-btn primary" disabled={busy !== null || !typed.trim() || !desk.configured}>
              {busy === 'typed' ? <LoaderCircle className="workbook-spinner" size={14} aria-hidden="true" /> : <ScanSearch size={14} aria-hidden="true" />}
              Analyse
            </button>
          </div>
        </form>
        {message && <output className="fd-msg bad">{message}</output>}

        {desk.runs.length > 0 && (
          <div className="rd-recent">
            <h3>Latest runs</h3>
            <ul>
              {desk.runs.slice(0, RECENT).map((run) => (
                <li key={run.id}>
                  <button type="button" onClick={() => setOpen(run.id)}>
                    <span>{run.symbol}<small>{run.tradeDate}</small></span>
                    {run.decision && run.status === 'done' ? <RatingChip rating={run.decision.rating} /> : <StatusChip status={run.status} />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="rd-foot">
          <span>{desk.monthUsed} of {desk.settings.monthlyRunCap} runs this month</span>
          <a className="cr-panel-link" href="/active/research">Open the full desk<ArrowUpRight size={14} aria-hidden="true" /></a>
        </p>
        <p className="fd-note">{RESEARCH_DISCLAIMER} Orbis never places or stages an order.</p>
      </section>
    </>
  );
}
