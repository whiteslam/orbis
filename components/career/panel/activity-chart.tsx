'use client';

import { useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';
import { MiniSwitch, PanelCard } from '@/components/career/panel/panel-bits';
import { percent, weeklySeries, type WeekPoint } from '@/components/career/panel/panel-data';
import type { CareerHome } from '@/lib/career/view';

type Range = '8' | '26';
const RANGES: ReadonlyArray<readonly [Range, string]> = [['8', '8 weeks'], ['26', '26 weeks']];

/*
 * Three series on one count axis. Sent is the volume underneath, a neutral
 * wash; replies (violet, the Replied stage) and interviews (green, the
 * Interview stage) are lines with end dots. Teal was left out on purpose: it
 * sits too close to the interview green for colour-blind readers (checked
 * with the dataviz validator), so sent stays neutral and every series is also
 * named in the legend and the table.
 */
const SERIES = [
  { key: 'sent', label: 'Sent', swatch: 'cp-sw-sent' },
  { key: 'replies', label: 'Replies', swatch: 'cp-sw-replies' },
  { key: 'interviews', label: 'Interviews', swatch: 'cp-sw-interviews' },
] as const;

function ChartTip({ active, payload }: Readonly<Partial<TooltipContentProps<number, string>>>) {
  const point = payload?.[0]?.payload as WeekPoint | undefined;
  if (!active || !point) return null;
  return (
    <div className="cp-tipbox">
      <b>Week of {point.label}</b>
      {SERIES.map((series) => (
        <span key={series.key}><i className={series.swatch} aria-hidden="true" />{series.label}<em>{point[series.key]}</em></span>
      ))}
    </div>
  );
}

/** Applications over time: sent per week with replies and interviews over it, 8 or 26 weeks. */
export function ActivityChart({ home }: Readonly<{ home: CareerHome }>) {
  const [range, setRange] = useState<Range>('8');
  const { points, partial, empty } = weeklySeries(home, Number(range));
  const totals = { sent: 0, replies: 0, interviews: 0 };
  for (const point of points) {
    totals.sent += point.sent;
    totals.replies += point.replies;
    totals.interviews += point.interviews;
  }
  const rate = totals.sent ? totals.replies / totals.sent : null;

  return (
    <PanelCard title="Applications over time" className="cp-a-chart" aside={<MiniSwitch label="Range" value={range} options={RANGES} onChange={setRange} />}>
      <p className="cp-hero-line">
        <b>{totals.sent}</b>
        <span>sent in {range} weeks{rate === null ? '' : `, ${percent(rate)} answered`}</span>
      </p>
      <ul className="cp-legend" aria-label="Series">
        {SERIES.map((series) => <li key={series.key}><i className={series.swatch} aria-hidden="true" />{series.label}<b>{totals[series.key]}</b></li>)}
      </ul>
      {empty ? (
        <div className="cp-chart-empty">
          <p>Nothing sent in the last {range} weeks yet. Each application you send lands here, with its replies and interviews.</p>
        </div>
      ) : (
        <div className="cp-chart" aria-hidden="true">
          <ResponsiveContainer width="100%" height={230}>
            <ComposedChart data={points} margin={{ top: 10, right: 8, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="cp-sent-wash" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--fd-soft)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="var(--fd-soft)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--cp-grid)" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} tick={{ fontSize: 11, fill: 'var(--fd-faint)' }} dy={6} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={44} tick={{ fontSize: 11, fill: 'var(--fd-faint)' }} />
              <Tooltip content={<ChartTip />} cursor={{ stroke: 'var(--fd-hairline)', strokeWidth: 1 }} />
              <Area type="monotone" dataKey="sent" stroke="var(--fd-soft)" strokeWidth={2} fill="url(#cp-sent-wash)" isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--cp-surface)' }} />
              <Line type="monotone" dataKey="replies" stroke="var(--series-5)" strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--cp-surface)' }} />
              <Line type="monotone" dataKey="interviews" stroke="var(--series-6)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--cp-surface)' }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      {partial && !empty && <p className="cp-foot-note">From your applications and the latest replies Orbis has seen. The full weekly record arrives with Insights.</p>}
      <table className="sr-only">
        <caption>Applications per week, last {range} weeks</caption>
        <thead><tr><th scope="col">Week of</th><th scope="col">Sent</th><th scope="col">Replies</th><th scope="col">Interviews</th></tr></thead>
        <tbody>{points.map((point) => <tr key={point.week}><th scope="row">{point.label}</th><td>{point.sent}</td><td>{point.replies}</td><td>{point.interviews}</td></tr>)}</tbody>
      </table>
    </PanelCard>
  );
}
