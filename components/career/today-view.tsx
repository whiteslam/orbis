'use client';

import { ArrowRight, Sparkles } from 'lucide-react';
import { AttentionList, StageStrip, attentionItems, attentionLead } from '@/components/career/attention';
import { allApplications, openCount } from '@/components/career/panel/panel-data';
import type { CareerHome } from '@/lib/career/view';

/** The week's sends against the goal, as one line and a thin meter. */
export function WeekLine({ week }: Readonly<{ week: CareerHome['week'] }>) {
  const share = Math.min(1, week.sent / Math.max(1, week.goal));
  return (
    <div className="cr-week">
      <p><b>{week.sent}</b> of {week.goal} sent this week<span>{week.sentLastWeek} last week</span></p>
      <div className="cr-meter" aria-hidden="true"><i style={{ width: `${share * 100}%` }} /></div>
    </div>
  );
}

/**
 * Today, the tab's first view: what needs you now, set big, then where every
 * application stands (the stage strip) and the week's pace. One surface: the
 * list of things to do. Everything else sits on the page.
 */
export function TodayView({ home, onOpenJobId, onApplications, onJobs }: Readonly<{
  home: CareerHome;
  onOpenJobId: (jobId: string) => void;
  onApplications: () => void;
  onJobs: () => void;
}>) {
  const items = attentionItems(home);
  const cards = allApplications(home);
  const open = openCount(cards);
  const matches = home.counts.forYou;
  return (
    <div className="cr-today">
      <section className="cr-today-now" aria-labelledby="cr-today-lead">
        <h2 className="cr-big" id="cr-today-lead">{attentionLead(items.length)}</h2>
        <AttentionList
          items={items}
          onOpen={onOpenJobId}
          onUnmatched={onApplications}
          empty={(
            <>
              <p>Nothing is waiting on you. Orbis is watching your inbox and will put replies, interviews and drafts here as they arrive.</p>
              <button type="button" className="cr-btn primary" onClick={onJobs}><Sparkles size={14} aria-hidden="true" />Look at new matches</button>
            </>
          )}
        />
      </section>
      <div className="cr-today-side">
        <section aria-labelledby="cr-today-stand">
          <h2 className="cr-h" id="cr-today-stand">Where things stand</h2>
          <p className="cr-sub">{open === 0 ? 'Nothing sent yet. Applications you send move along here as replies come in.' : `${open} in play. Orbis moves each one along as replies arrive in Gmail.`}</p>
          <StageStrip cards={cards} />
          <button type="button" className="fd-link cr-more-link" onClick={onApplications}>See every application<ArrowRight size={13} aria-hidden="true" /></button>
        </section>
        <section aria-labelledby="cr-today-week">
          <h2 className="cr-h" id="cr-today-week">This week</h2>
          <WeekLine week={home.week} />
          {matches > 0 && (
            <button type="button" className="fd-link cr-more-link" onClick={onJobs}>{matches === 1 ? '1 new match' : `${matches} new matches`} above your bar<ArrowRight size={13} aria-hidden="true" /></button>
          )}
        </section>
      </div>
    </div>
  );
}
