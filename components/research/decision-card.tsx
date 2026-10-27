'use client';

import { positionLine } from '@/lib/research/timeline';
import { trackRecord } from '@/lib/research/track';
import { RESEARCH_DISCLAIMER, type ResearchRun, type ResearchSettlement } from '@/lib/research/types';

const TONE: Record<string, string> = { Buy: 'up', Overweight: 'up', Hold: 'flat', Underweight: 'down', Sell: 'down', REVIEW: 'none' };

const price = (value: number | null) => (value === null ? null : `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);

export function RatingChip({ rating }: Readonly<{ rating: string }>) {
  return <span className={`rd-chip is-${TONE[rating] ?? 'none'}`}>{rating === 'REVIEW' ? 'No clear call' : rating}</span>;
}

/** How past calls did, always shown beside a call. */
export function TrackRecordLine({ settlements }: Readonly<{ settlements: readonly ResearchSettlement[] }>) {
  return <p className="rd-track">{trackRecord(settlements).line}</p>;
}

/**
 * The Portfolio Manager's call: the rating, why, the levels, and what it means
 * for the position held. Labelled as research every time, with the track
 * record beside it; nothing here places or stages an order.
 */
export function DecisionCard({ run, settlements, settlement }: Readonly<{ run: ResearchRun; settlements: readonly ResearchSettlement[]; settlement?: ResearchSettlement | null }>) {
  const decision = run.decision;
  if (!decision) return null;
  const levels = [
    ['Price target', price(decision.priceTarget)],
    ['Horizon', decision.horizon],
    ['Entry', price(decision.entry)],
    ['Stop', price(decision.stop)],
    ['Sizing', decision.sizing],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  const position = positionLine(run.portfolio, run.ticker);
  return (
    <section className="rd-decision" aria-label={`The call on ${run.symbol}`}>
      <div className="rd-decision-head">
        <RatingChip rating={decision.rating} />
        <span className="rd-decision-for">{run.symbol} · {run.tradeDate}</span>
      </div>
      {decision.rating === 'REVIEW' && <p className="rd-decision-summary">The Portfolio Manager’s answer had no readable rating, so this run makes no call. Read its reasoning in the timeline.</p>}
      {decision.summary && <p className="rd-decision-summary">{decision.summary}</p>}
      {position && <p className="rd-decision-position">{position}{decision.trader ? ` The trader proposed: ${decision.trader}.` : ''}</p>}
      {levels.length > 0 && (
        <dl className="rd-levels">
          {levels.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      )}
      {decision.thesis && (
        <details className="rd-thesis">
          <summary>The thesis</summary>
          <p>{decision.thesis}</p>
        </details>
      )}
      {settlement && (
        <p className="rd-settled">
          Settled after {settlement.holdingDays} trading days: {settlement.returnPct >= 0 ? '+' : '−'}{Math.abs(settlement.returnPct).toFixed(1)}% against {settlement.benchmark === '^BSESN' ? 'Sensex' : 'Nifty'} {settlement.benchmarkPct >= 0 ? '+' : '−'}{Math.abs(settlement.benchmarkPct).toFixed(1)}%.
        </p>
      )}
      <TrackRecordLine settlements={settlements} />
      <p className="rd-disclaimer">{RESEARCH_DISCLAIMER}</p>
    </section>
  );
}
