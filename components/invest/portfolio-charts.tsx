'use client';

import type { AssetClass, PortfolioAnalysis, Status } from '@/lib/invest/analysis';
import { compactInr, inr, percent } from '@/components/invest/format';

// Validated categorical palette, one fixed hue per asset class.
const CLASS_COLOR: Record<AssetClass, string> = {
  Stocks: 'var(--series-1)',
  ETFs: 'var(--series-2)',
  'Mutual funds': 'var(--series-3)',
  'Gold & silver': 'var(--series-4)',
  Crypto: 'var(--series-5)',
  Cash: 'var(--series-6)',
  Other: 'var(--series-7)',
};

// The dot carries the reading at a glance; the word carries it for anyone who
// can't use the colour, so the status is never colour alone.
const STATUS_LABEL: Record<Status, string> = { good: 'Healthy', warning: 'Worth watching', critical: 'High risk' };

function Reading({ title, value, status, detail }: { title: string; value: string; status: Status; detail: string }) {
  return (
    <div className={`invest-reading ${status}`}>
      <i aria-hidden="true" />
      <span>{title}</span>
      <b>{value}</b>
      <small>{STATUS_LABEL[status]} · {detail}</small>
    </div>
  );
}

/**
 * Three readings on the shape of the portfolio, set as hairline rows on the
 * ground rather than as cards: the screen already carries a total, a list and
 * an allocation, and boxing these made four competing surfaces out of one page.
 */
export function PortfolioHealth({ analysis }: { analysis: PortfolioAnalysis }) {
  const classes = analysis.byClass.map((item) => item.assetClass);
  return (
    <div className="invest-health">
      <Reading
        title="Largest position"
        value={analysis.largest ? percent(analysis.largest.share) : '—'}
        status={analysis.concentration}
        detail={analysis.largest
          ? `${analysis.largest.name}. Past about a quarter of the total, one holding sets the tone for everything.`
          : 'Nothing to weigh yet.'}
      />
      <Reading
        title="Diversification"
        value={analysis.effectiveHoldings.toFixed(1)}
        status={analysis.diversification}
        detail={`${analysis.positions.length} holdings that spread risk like ${analysis.effectiveHoldings.toFixed(1)} independent ones.`}
      />
      <Reading
        title="Asset classes"
        value={String(analysis.byClass.length)}
        status={analysis.mix}
        detail={classes.length ? `${classes.join(', ')}. Three or more usually ride out a bad year better.` : 'Nothing held yet.'}
      />
    </div>
  );
}

/** Where the money sits: by class as one strip, then the holdings that fill it. */
export function AllocationBreakdown({ analysis }: { analysis: PortfolioAnalysis }) {
  const top = analysis.positions.slice(0, 6);
  const rest = analysis.positions.slice(6).reduce((sum, position) => sum + position.value, 0);
  const rows = rest > 0
    ? [...top.map((position) => ({ key: position.key, name: position.name, value: position.value })), { key: 'other', name: `${analysis.positions.length - 6} others`, value: rest }]
    : top.map((position) => ({ key: position.key, name: position.name, value: position.value }));
  const maxShare = Math.max(...rows.map((row) => row.value / analysis.total), 0.0001);

  return (
    <section className="invest-allocation" aria-label="Allocation">
      <div className="invest-strip" role="img" aria-label={analysis.byClass.map((item) => `${item.assetClass} ${percent(item.share)}`).join(', ')}>
        {analysis.byClass.map((item) => (
          <i key={item.assetClass} style={{ flexGrow: item.share, background: CLASS_COLOR[item.assetClass] }} title={`${item.assetClass}: ${inr(item.value)} (${percent(item.share)})`} />
        ))}
      </div>
      <ul className="invest-legend">
        {analysis.byClass.map((item) => (
          <li key={item.assetClass}><i style={{ background: CLASS_COLOR[item.assetClass] }} /><span>{item.assetClass}</span><strong>{percent(item.share)}</strong><small>{compactInr(item.value)}</small></li>
        ))}
      </ul>

      <p className="invest-sublabel">By holding</p>
      <div className="invest-bars">
        {rows.map((row) => {
          const share = row.value / analysis.total;
          return (
            <div className="invest-bar" key={row.key} title={`${row.name}: ${inr(row.value)} (${percent(share)})`}>
              <span>{row.name}</span>
              <div><i style={{ width: `${(share / maxShare) * 100}%` }} /></div>
              <strong>{percent(share)}</strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}
