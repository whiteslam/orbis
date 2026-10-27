'use client';

import { useState } from 'react';
import { SOURCE_NAME } from '@/components/career/format';
import { InsightsView } from '@/components/career/insights-view';
import { PanelCard } from '@/components/career/panel/panel-bits';
import { percent } from '@/components/career/panel/panel-data';
import type { CareerInsights } from '@/lib/career/types';
import type { CareerHome } from '@/lib/career/view';

function Rate({ part, whole }: Readonly<{ part: number; whole: number }>) {
  if (!whole) return <span className="cp-rate none">–</span>;
  const share = part / whole;
  return (
    <span className="cp-rate">
      <span>{percent(share)}</span>
      <i aria-hidden="true"><i style={{ width: `${Math.min(100, share * 100)}%` }} /></i>
    </span>
  );
}

/** Which sources bring matches and which bring replies: counts with the two rates that matter. */
function SourcePerformance({ sources }: Readonly<{ sources: CareerInsights['sources'] }>) {
  const rows = [...sources].filter((row) => row.jobs > 0).sort((left, right) => right.replies - left.replies || right.matches - left.matches || right.jobs - left.jobs);
  return (
    <PanelCard title="Source performance" className="cp-sources" aside={<span className="cp-tag">Last 8 weeks</span>}>
      {rows.length === 0 ? <p className="cp-quiet">No jobs in yet. Each source’s matches and replies show here once searches run.</p> : (
        <div className="cp-table-wrap">
          <table className="cp-table">
            <caption className="sr-only">Jobs, matches, applications and replies per source</caption>
            <thead>
              <tr><th scope="col">Source</th><th scope="col" className="num">Jobs</th><th scope="col" className="num">Matches</th><th scope="col">Match rate</th><th scope="col" className="num">Applied</th><th scope="col" className="num">Replies</th><th scope="col">Reply rate</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.source}>
                  <th scope="row">{SOURCE_NAME[row.source]}</th>
                  <td className="num">{row.jobs}</td>
                  <td className="num">{row.matches}</td>
                  <td><Rate part={row.matches} whole={row.jobs} /></td>
                  <td className="num">{row.applied}</td>
                  <td className="num">{row.replies}</td>
                  <td><Rate part={row.replies} whole={row.applied} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelCard>
  );
}

/** Insights: the tab's cards in two columns, then the wider source table. */
export function InsightsPage({ home }: Readonly<{ home: CareerHome }>) {
  const [insights, setInsights] = useState<CareerInsights | null>(home.insights);
  return (
    <div className="cp-insights">
      <InsightsView initial={home.insights} spec={home.state.spec} showSources={false} onInsights={setInsights} />
      {insights && <SourcePerformance sources={insights.sources} />}
    </div>
  );
}
