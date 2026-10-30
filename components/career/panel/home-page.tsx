'use client';

import { ArrowRight, Sparkles } from 'lucide-react';
import { AttentionList, StageStrip } from '@/components/career/attention';
import { creditFor, freshness, salaryText } from '@/components/career/format';
import { FitTag } from '@/components/career/fit-review-view';
import { WeekLine } from '@/components/career/today-view';
import { Predictions, RecentActivity } from '@/components/career/panel/overview-cards';
import { usePanel } from '@/components/career/panel/panel-context';
import { allApplications, hrefFor, openCount, weekPace } from '@/components/career/panel/panel-data';
import { panelAttention } from '@/components/career/panel/title-row';
import type { CareerJob } from '@/lib/career/types';
import type { CareerHome } from '@/lib/career/view';

/** A new match as a row: its score, what it is, and what it pays. */
function MatchRow({ job, drafted, onOpen, languages }: Readonly<{ job: CareerJob; drafted: boolean; onOpen: () => void; languages: readonly string[] }>) {
  const salary = salaryText(job.salary ?? job.requirements?.salary ?? null);
  const fresh = freshness(job);
  return (
    <li>
      <button type="button" className="cp-match" onClick={onOpen}>
        <span className="cp-match-score" aria-label={job.score === null ? 'Not scored' : `Match ${job.score}`}>{job.score ?? '–'}</span>
        <span className="cp-match-text">
          <b>{job.title}</b>
          <small>{job.company}{drafted ? ', draft ready' : ''}<FitTag job={job} languages={languages} /></small>
        </span>
        <span className="cp-match-pay">
          <b>{salary ?? 'Salary not stated'}</b>
          <small>{fresh.text}, {creditFor(job).replace(/^via /, '')}</small>
        </span>
      </button>
    </li>
  );
}

/**
 * Home: what needs you now (the one surface), then where every application
 * stands as the stage strip, new matches as rows, and the week, the forecast
 * and what happened lately down the right.
 */
export function HomePage({ home }: Readonly<{ home: CareerHome }>) {
  const { openJob, openJobId } = usePanel();
  const items = panelAttention(home);
  const cards = allApplications(home);
  const open = openCount(cards);
  const drafted = new Set(home.queue.map((card) => card.job.id));
  const jobs = home.hotMatches.slice(0, 5);
  const pace = weekPace(home.week);
  let paceLine = `Send ${pace.perDay} a day to reach your goal by Sunday.`;
  if (pace.done) paceLine = 'Goal met for this week. Anything more is a bonus.';
  else if (pace.daysLeft === 1) paceLine = `${pace.left} to go today to reach it.`;

  return (
    <div className="cp-home">
      <section className="cp-home-now" aria-label="Needs you">
        <AttentionList
          items={items}
          onOpen={openJobId}
          empty={(
            <>
              <p>Nothing is waiting on you. Orbis is watching your inbox and will put replies, interviews and drafts here as they arrive.</p>
              <a className="cr-btn primary cp-cta" href={hrefFor('jobs')}><Sparkles size={14} aria-hidden="true" />Look at new matches</a>
            </>
          )}
        />
      </section>

      <section className="cp-home-matches" aria-labelledby="cp-home-matches-title">
        <h2 className="cr-h" id="cp-home-matches-title">New matches</h2>
        {jobs.length === 0 ? (
          <p className="cr-sub">No new matches above your bar right now. Orbis searches every few hours; run a search from Jobs to look now.</p>
        ) : (
          <>
            <p className="cr-sub">Above your bar of {home.state.settings.threshold}, best first.</p>
            <ul className="cp-matches">{jobs.map((job) => <MatchRow key={job.id} job={job} drafted={drafted.has(job.id)} onOpen={() => openJob(job)} languages={home.state.profile?.languages ?? []} />)}</ul>
          </>
        )}
        <a className="cp-link cr-more-link" href={hrefFor('jobs')}>All jobs<ArrowRight size={13} aria-hidden="true" /></a>
      </section>

      <div className="cp-home-side">
        <section className="cp-home-pipe" aria-labelledby="cp-home-pipe-title">
          <h2 className="cr-h" id="cp-home-pipe-title">Where things stand</h2>
          <p className="cr-sub">{open === 0 ? 'Nothing sent yet. Applications you send move along here as replies come in.' : `${open} in play, of ${cards.length}. Orbis moves each one along as replies arrive in Gmail.`}</p>
          <StageStrip cards={cards} onPick={(stage) => { window.location.hash = `/pipeline?stage=${stage}`; }} label="Open applications at a stage" />
          <a className="cp-link cr-more-link" href={hrefFor('pipeline')}>Open applications<ArrowRight size={13} aria-hidden="true" /></a>
        </section>

        <section className="cp-home-week" aria-labelledby="cp-home-week-title">
          <h2 className="cr-h" id="cp-home-week-title">This week</h2>
          <WeekLine week={home.week} />
          <p className="cr-sub">{paceLine} <a className="cp-inline-link" href={hrefFor('setup')}>Change the goal</a></p>
        </section>

        <div className="cp-home-forecast"><Predictions home={home} /></div>
        <div className="cp-home-recent"><RecentActivity home={home} /></div>
      </div>
    </div>
  );
}
