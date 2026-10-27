'use client';

import { useEffect, useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { insightsAction } from '@/app/career/actions';
import { NoticeLine } from '@/components/career/bits';
import { countRange, moneyShort, salaryText, SOURCE_NAME } from '@/components/career/format';
import { useRun } from '@/components/career/use-run';
import type { CareerInsights, CareerSpec, Money, SalaryPulse, SkillGap } from '@/lib/career/types';

const AXIS = { line: 'var(--fd-rule)', text: 'var(--fd-faint)' };

/** "2026-W43" → "W43". */
const weekLabel = (week: string) => week.slice(week.indexOf('W'));

function Card({ title, sample, children }: Readonly<{ title: string; sample: string; children: React.ReactNode }>) {
  const id = `cr-in-${title.toLowerCase().replaceAll(/\W+/g, '-')}`;
  return (
    <section className="mn-card cr-insight" aria-labelledby={id}>
      <div className="fd-label-row">
        <h2 className="fd-label" id={id}>{title}</h2>
        <span className="cr-sample">{sample}</span>
      </div>
      {children}
    </section>
  );
}

function Forecast({ forecast }: Readonly<{ forecast: CareerInsights['forecast'] }>) {
  return (
    <Card title="Next 14 days" sample={forecast.early ? 'Early estimate' : 'From your outcomes'}>
      <div className="cr-forecast">
        <p><b>{countRange(forecast.replies)}</b><span>replies</span></p>
        <p><b>{countRange(forecast.interviews)}</b><span>interviews</span></p>
      </div>
      <p className="cr-block-note">
        {forecast.early
          ? 'From a starting model and the applications you have out. The ranges narrow as replies come in.'
          : 'From your open applications and how long companies have taken to reply to you so far.'}
      </p>
    </Card>
  );
}

function SkillGaps({ gaps }: Readonly<{ gaps: SkillGap[] }>) {
  const top = gaps.slice(0, 6);
  const most = Math.max(1, ...top.map((gap) => gap.jobsItWouldUnlock));
  return (
    <Card title="Skill gaps" sample="Exact, from your scored jobs">
      {top.length === 0 ? <p className="fd-empty">No recurring gaps. Nothing you lack shows up across several jobs.</p> : (
        <ul className="cr-gaps-list">
          {top.map((gap) => (
            <li key={gap.skill}>
              <p>Adding <b>{gap.skill}</b> would put <b>{gap.jobsItWouldUnlock}</b> more {gap.jobsItWouldUnlock === 1 ? 'job' : 'jobs'} above your bar</p>
              <div className="cr-meter" aria-hidden="true"><i style={{ width: `${(gap.jobsItWouldUnlock / most) * 100}%` }} /></div>
              <small>Asked for by {gap.jobsMissingIt} jobs you don’t fully match</small>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Where a value sits on the strip, as a share of its width. */
function at(value: number, low: number, high: number) {
  return `${Math.max(0, Math.min(100, ((value - low) / (high - low || 1)) * 100))}%`;
}

function sameUnit(money: Money | null, pulse: SalaryPulse): money is Money {
  return Boolean(money && money.currency.toUpperCase() === pulse.currency.toUpperCase() && money.period === pulse.period);
}

/** p25–p75 as a band, the median as a line, and the owner's floor and target as labelled ticks. */
function SalaryStrip({ pulse, spec }: Readonly<{ pulse: SalaryPulse; spec: CareerSpec | null }>) {
  const floor = sameUnit(spec?.salaryFloor ?? null, pulse) ? spec?.salaryFloor ?? null : null;
  const target = sameUnit(spec?.salaryTarget ?? null, pulse) ? spec?.salaryTarget ?? null : null;
  const values = [pulse.p25, pulse.p75, floor?.amount, target?.amount].filter((value): value is number => typeof value === 'number');
  const low = Math.min(...values) * 0.9;
  const high = Math.max(...values) * 1.08;
  const show = (amount: number) => moneyShort(amount, pulse.currency);
  return (
    <div className="cr-pulse">
      <p className="cr-pulse-head"><b>{salaryText({ min: pulse.p25, max: pulse.p75, currency: pulse.currency, period: pulse.period })}</b>, the middle half of listings</p>
      <div className="cr-strip" role="img" aria-label={`Listings pay ${show(pulse.p25)} to ${show(pulse.p75)}, median ${show(pulse.p50)}${floor ? `. Your floor is ${show(floor.amount)}` : ''}${target ? `, your target ${show(target.amount)}` : ''}.`}>
        <span className="cr-strip-band" style={{ left: at(pulse.p25, low, high), right: `calc(100% - ${at(pulse.p75, low, high)})` }} />
        <span className="cr-strip-mid" style={{ left: at(pulse.p50, low, high) }}><small>Median {show(pulse.p50)}</small></span>
        {floor && <span className="cr-strip-tick floor" style={{ left: at(floor.amount, low, high) }}><small>Floor</small></span>}
        {target && <span className="cr-strip-tick target" style={{ left: at(target.amount, low, high) }}><small>Target</small></span>}
      </div>
      <p className="cr-pulse-foot">From {pulse.sample} {pulse.sample === 1 ? 'listing' : 'listings'} that state pay{pulse.sample < 10 ? ', too few to lean on' : ''}.</p>
    </div>
  );
}

function SalaryPulseCard({ salary, spec }: Readonly<{ salary: SalaryPulse[]; spec: CareerSpec | null }>) {
  const sample = salary.reduce((sum, pulse) => sum + pulse.sample, 0);
  return (
    <Card title="Salary pulse" sample={`${sample} ${sample === 1 ? 'listing' : 'listings'}`}>
      {salary.length === 0 ? <p className="fd-empty">Not enough listings state pay yet.</p> : salary.slice(0, 2).map((pulse) => <SalaryStrip key={`${pulse.currency}-${pulse.period}`} pulse={pulse} spec={spec} />)}
    </Card>
  );
}

function MarketPulse({ market }: Readonly<{ market: CareerInsights['market'] }>) {
  const total = market.reduce((sum, week) => sum + week.jobs, 0);
  const last = market.at(-1)?.jobs ?? 0;
  const before = market.at(-2)?.jobs ?? 0;
  const data = market.map((week) => ({ week: weekLabel(week.week), jobs: week.jobs }));
  return (
    <Card title="Market pulse" sample={`${total} jobs over ${market.length} weeks`}>
      <p className="cr-pulse-head"><b>{last}</b> matching {last === 1 ? 'job' : 'jobs'} this week, {before} the week before</p>
      <div className="cr-chart" aria-hidden="true">
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={data} margin={{ top: 6, right: 0, bottom: 0, left: 0 }} barCategoryGap="24%">
            <XAxis dataKey="week" tickLine={false} axisLine={{ stroke: AXIS.line }} tick={{ fontSize: 10, fill: AXIS.text }} />
            <YAxis orientation="right" tickLine={false} axisLine={false} width={26} allowDecimals={false} tick={{ fontSize: 10, fill: AXIS.text }} />
            <Tooltip cursor={{ fill: 'var(--fd-wash)' }} formatter={(value) => [`${Number(value)} jobs`, '']} separator="" />
            <Bar dataKey="jobs" fill="var(--fd-accent)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Matching jobs per week</caption>
        <thead><tr><th scope="col">Week</th><th scope="col">Jobs</th></tr></thead>
        <tbody>{data.map((week) => <tr key={week.week}><td>{week.week}</td><td>{week.jobs}</td></tr>)}</tbody>
      </table>
    </Card>
  );
}

function Sources({ sources }: Readonly<{ sources: CareerInsights['sources'] }>) {
  const rows = [...sources].sort((left, right) => right.matches - left.matches || right.jobs - left.jobs).filter((row) => row.jobs > 0);
  return (
    <Card title="Sources" sample="Last 8 weeks">
      {rows.length === 0 ? <p className="fd-empty">No jobs in yet.</p> : (
        <table className="cr-table">
          <thead><tr><th scope="col">Source</th><th scope="col">Jobs</th><th scope="col">Matches</th><th scope="col">Applied</th><th scope="col">Replies</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.source}>
                <th scope="row">{SOURCE_NAME[row.source]}</th>
                <td>{row.jobs}</td><td>{row.matches}</td><td>{row.applied}</td><td>{row.replies}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function Timing({ freshness, bestDay }: Readonly<{ freshness: CareerInsights['freshness']; bestDay: CareerInsights['bestDay'] }>) {
  return (
    <Card title="Timing" sample={freshness.fromData ? 'From your replies' : 'A starting rule'}>
      <p className="cr-timing">{freshness.advice}</p>
      <p className="cr-timing-day">
        {bestDay.day
          ? <>Your replies come most often from applications sent on a <b>{bestDay.day}</b>.</>
          : <>Best day to apply shows after <b>{bestDay.needMore}</b> more sent {bestDay.needMore === 1 ? 'application' : 'applications'}.</>}
      </p>
    </Card>
  );
}

/** Insights: forecast, skill gaps, salary and market pulse, sources and timing. Every figure says how sure it is. */
export function InsightsView({ initial, spec }: Readonly<{ initial: CareerInsights | null; spec: CareerSpec | null }>) {
  const [insights, setInsights] = useState<CareerInsights | null>(initial);
  const { busy, notice, run } = useRun();
  useEffect(() => {
    void run('load', () => insightsAction(), setInsights);
  }, [run]);

  if (!insights) {
    return (
      <div className="cr-view">
        {busy === 'load' && <p className="fd-empty">Working out your numbers…</p>}
        <NoticeLine notice={notice} />
        {!busy && !notice && <p className="fd-empty">Insights appear once a few jobs are in.</p>}
      </div>
    );
  }
  return (
    <div className="cr-view">
      {notice && <p className="cr-quiet-error">Showing the last numbers. Fresh ones didn’t load: {notice.text}</p>}
      <Forecast forecast={insights.forecast} />
      <SkillGaps gaps={insights.skillGaps} />
      <SalaryPulseCard salary={insights.salary} spec={spec} />
      <MarketPulse market={insights.market} />
      <Sources sources={insights.sources} />
      <Timing freshness={insights.freshness} bestDay={insights.bestDay} />
    </div>
  );
}
