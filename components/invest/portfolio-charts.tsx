'use client';

import { useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertOctagon, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { projectGrowth, type AssetClass, type PortfolioAnalysis, type Status } from '@/lib/invest/analysis';
import { compactInr, inr, percent } from '@/components/invest/format';

// Validated categorical palette (light surface), one fixed hue per asset class.
const CLASS_COLOR: Record<AssetClass, string> = {
  Stocks: 'var(--series-1)',
  ETFs: 'var(--series-2)',
  'Mutual funds': 'var(--series-3)',
  'Gold & silver': 'var(--series-4)',
  Crypto: 'var(--series-5)',
  Cash: 'var(--series-6)',
  Other: 'var(--series-7)',
};

const STATUS_ICON = { good: CheckCircle2, warning: AlertTriangle, critical: AlertOctagon } as const;
const STATUS_LABEL = { good: 'Healthy', warning: 'Watch', critical: 'High risk' } as const;

function Indicator({ title, value, status, detail }: { title: string; value: string; status: Status; detail: string }) {
  const Icon = STATUS_ICON[status];
  return (
    <div className={`invest-indicator ${status}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      <em><Icon size={12} aria-hidden="true" />{STATUS_LABEL[status]}</em>
      <small>{detail}</small>
    </div>
  );
}

export function PortfolioIndicators({ analysis }: { analysis: PortfolioAnalysis }) {
  return (
    <div className="invest-indicators">
      <Indicator
        title="Largest position"
        value={analysis.largest ? percent(analysis.largest.share) : '—'}
        status={analysis.concentration}
        detail={analysis.largest ? `${analysis.largest.name} · aim for 25% or less` : 'No holdings yet'}
      />
      <Indicator
        title="Diversification"
        value={analysis.effectiveHoldings.toFixed(1)}
        status={analysis.diversification}
        detail={`Effective holdings (by weight) of ${analysis.positions.length}`}
      />
      <Indicator
        title="Asset classes"
        value={String(analysis.byClass.length)}
        status={analysis.mix}
        detail={analysis.byClass.length >= 3 ? 'Spread across classes' : 'Add another asset class'}
      />
    </div>
  );
}

export function AllocationCharts({ analysis }: { analysis: PortfolioAnalysis }) {
  const top = analysis.positions.slice(0, 6);
  const rest = analysis.positions.slice(6).reduce((sum, position) => sum + position.value, 0);
  const rows = rest > 0 ? [...top.map((position) => ({ key: position.key, name: position.name, value: position.value })), { key: 'other', name: `${analysis.positions.length - 6} others`, value: rest }] : top.map((position) => ({ key: position.key, name: position.name, value: position.value }));
  const maxShare = Math.max(...rows.map((row) => row.value / analysis.total), 0.0001);

  return (
    <section className="invest-panel" aria-labelledby="allocation-title">
      <h3 id="allocation-title">Allocation</h3>

      <p className="invest-panel-label">By asset class</p>
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

      <p className="invest-panel-label">By holding</p>
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

export function GrowthProjector({ startValue }: { startValue: number }) {
  const [monthly, setMonthly] = useState('5000');
  const [rate, setRate] = useState(12);
  const [years, setYears] = useState(10);
  const monthlyAmount = Math.max(0, Math.min(10_000_000, Number(monthly) || 0));
  const points = useMemo(() => projectGrowth(startValue, monthlyAmount, rate, years), [monthlyAmount, rate, startValue, years]);
  const final = points[points.length - 1];
  const gain = final.value - final.contributed;

  return (
    <section className="invest-panel" aria-labelledby="projector-title">
      <h3 id="projector-title">Growth projector</h3>
      <p className="invest-panel-note">Starts from today’s {inr(startValue)} and adds a monthly SIP at a steady assumed return. A what-if, not a forecast.</p>

      <div className="invest-projector-controls">
        <label>Monthly SIP (₹)<input inputMode="numeric" type="number" min="0" step="500" value={monthly} onChange={(event) => setMonthly(event.currentTarget.value)} /></label>
        <label>Return / year <b>{rate}%</b><input type="range" min="4" max="18" step="0.5" value={rate} onChange={(event) => setRate(Number(event.currentTarget.value))} /></label>
        <label>Years <b>{years}</b><input type="range" min="1" max="30" step="1" value={years} onChange={(event) => setYears(Number(event.currentTarget.value))} /></label>
      </div>

      <div className="invest-projection-stats">
        <div><span>Projected value</span><strong>{compactInr(final.value)}</strong></div>
        <div><span>You put in</span><strong>{compactInr(final.contributed)}</strong></div>
        <div><span>Growth</span><strong className="up">{compactInr(gain)}</strong></div>
      </div>

      <ul className="invest-legend inline" aria-hidden="true">
        <li><i style={{ background: 'var(--series-1)' }} /><span>Projected value</span></li>
        <li><i className="line" style={{ background: 'var(--series-2)' }} /><span>Amount put in</span></li>
      </ul>
      <div className="invest-chart">
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={points} margin={{ top: 8, right: 6, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="projection-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2a78d6" stopOpacity={0.28} />
                <stop offset="100%" stopColor="#2a78d6" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="#e8edf3" />
            <XAxis dataKey="year" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: '#75808f' }} tickFormatter={(year: number) => `${year}y`} interval="preserveStartEnd" />
            <YAxis tickLine={false} axisLine={false} width={46} tick={{ fontSize: 9, fill: '#75808f' }} tickFormatter={(value: number) => compactInr(value)} />
            <Tooltip
              cursor={{ stroke: '#75808f', strokeWidth: 1, strokeDasharray: '3 3' }}
              contentStyle={{ borderRadius: 10, border: '1px solid #e8edf3', fontSize: 11, boxShadow: '0 8px 24px rgba(29,45,57,.08)' }}
              labelFormatter={(year) => `Year ${year}`}
              formatter={(value, name) => [inr(Number(value)), name === 'value' ? 'Projected value' : 'Amount put in']}
            />
            <Area type="monotone" dataKey="value" stroke="#2a78d6" strokeWidth={2} fill="url(#projection-fill)" activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }} />
            <Line type="monotone" dataKey="contributed" stroke="#eb6834" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Projected portfolio value by year</caption>
        <thead><tr><th>Year</th><th>Projected value</th><th>Amount put in</th></tr></thead>
        <tbody>{points.map((point) => <tr key={point.year}><td>{point.year}</td><td>{inr(point.value)}</td><td>{inr(point.contributed)}</td></tr>)}</tbody>
      </table>
    </section>
  );
}
