'use client';

import { useState } from 'react';
import { ArrowUpRight, CalendarClock, Link2, Video } from 'lucide-react';
import { MeetingLink } from '@/components/career/bits';
import { dayTime } from '@/components/career/format';
import { PrepPack } from '@/components/career/sheet/prep-pack';
import { StatusChip } from '@/components/career/status-chip';
import { PanelCard, PanelEmpty } from '@/components/career/panel/panel-bits';
import { usePanel } from '@/components/career/panel/panel-context';
import { allApplications, istDay, latestEvents, untilText } from '@/components/career/panel/panel-data';
import type { ApplicationCard, CareerHome, UpcomingInterview } from '@/lib/career/view';

function dayHeading(iso: string | null): string {
  if (!iso) return 'Time not given yet';
  const today = istDay(new Date());
  const tomorrow = istDay(new Date(Date.now() + 86_400_000));
  const day = istDay(iso);
  const date = new Date(iso).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });
  if (day === today) return `Today, ${date}`;
  if (day === tomorrow) return `Tomorrow, ${date}`;
  return date;
}

function timeOnly(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

/** Upcoming interviews grouped by day, soonest first. */
function groupByDay(items: UpcomingInterview[]): Array<{ heading: string; items: UpcomingInterview[] }> {
  const groups = new Map<string, UpcomingInterview[]>();
  const sorted = [...items].sort((left, right) => (left.at ?? '9').localeCompare(right.at ?? '9'));
  for (const item of sorted) {
    const heading = dayHeading(item.at);
    groups.set(heading, [...(groups.get(heading) ?? []), item]);
  }
  return [...groups].map(([heading, list]) => ({ heading, items: list }));
}

function AgendaItem({ item, selected, onSelect }: Readonly<{ item: UpcomingInterview; selected: boolean; onSelect: () => void }>) {
  return (
    <li>
      <button type="button" className={`cp-agenda-item${selected ? ' on' : ''}`} aria-pressed={selected} onClick={onSelect}>
        <span className="cp-agenda-time">{item.at ? <><b>{timeOnly(item.at)}</b><small>{untilText(item.at)}</small></> : <b>TBC</b>}</span>
        <span className="cp-agenda-text">
          <b>{item.job.company}</b>
          <span>{item.job.title}</span>
          <small>{item.format ?? 'Format not given'}{item.application.prep ? ', prep pack ready' : ''}</small>
        </span>
      </button>
    </li>
  );
}

/** The selected interview's logistics and its prep pack (the sheet's own section). */
function PrepColumn({ item }: Readonly<{ item: UpcomingInterview }>) {
  const { sheet, openJob } = usePanel();
  return (
    <PanelCard
      title={`${item.job.company}, ${item.job.title}`}
      className="cp-prep"
      aside={<button type="button" className="cp-link" onClick={() => openJob(item.job, item)}>Application<ArrowUpRight size={14} aria-hidden="true" /></button>}
    >
      {item.application.prep ? <PrepPack prep={item.application.prep} profile={sheet.profile} /> : (
        <>
          <ul className="cr-logistics">
            <li><CalendarClock size={14} aria-hidden="true" /><span>{item.at ? dayTime(item.at) : 'Time not given yet'}</span></li>
            {item.format && <li><Video size={14} aria-hidden="true" /><span>{item.format}</span></li>}
            {item.link && <li><Link2 size={14} aria-hidden="true" /><MeetingLink url={item.link} /></li>}
          </ul>
          <p className="cp-quiet">The prep pack is written when the invite is read. If it’s missing, open the application and check its timeline.</p>
        </>
      )}
    </PanelCard>
  );
}

function PastInterviews({ past }: Readonly<{ past: Array<ApplicationCard & { summary: string | null }> }>) {
  const { openJob } = usePanel();
  return (
    <PanelCard title="Past interviews" className="cp-past">
      {past.length === 0 ? <p className="cp-quiet">Interviews you’ve had show here with how they turned out.</p> : (
        <ul className="cp-past-list">
          {past.map((card) => (
            <li key={card.application.id}>
              <button type="button" onClick={() => openJob(card.job, card)}>
                <span><b>{card.job.company}</b><small>{card.job.title}</small>{card.summary && <span>{card.summary}</span>}</span>
                <StatusChip status={card.application.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </PanelCard>
  );
}

/** Interviews: the agenda with its prep packs, and the ones already had with their outcomes. */
export function InterviewsPage({ home }: Readonly<{ home: CareerHome }>) {
  // Read once per visit: an interview stays in the agenda for two hours after it starts.
  const [now] = useState(() => Date.now());
  const upcoming = home.upcoming.filter((item) => !item.at || Date.parse(item.at) > now - 2 * 3_600_000);
  const upcomingIds = new Set(upcoming.map((item) => item.application.id));
  const latest = latestEvents(home);
  // Had an interview: a prep pack was made for it, and it isn't still ahead.
  const past = allApplications(home)
    .filter((card) => card.application.prep && !upcomingIds.has(card.application.id))
    .map((card) => ({ ...card, summary: latest.get(card.application.id)?.summary ?? null }));
  const [picked, setPicked] = useState<string | null>(null);
  const selected = upcoming.find((item) => item.application.id === picked) ?? upcoming[0] ?? null;

  if (upcoming.length === 0 && past.length === 0) {
    return <PanelEmpty title="No interviews yet.">When a company invites you, Orbis reads the email, books it here and writes a prep pack for it.</PanelEmpty>;
  }

  return (
    <div className="cp-interviews">
      <div className="cp-agenda-col">
        <PanelCard title="Upcoming" className="cp-agenda">
          {upcoming.length === 0 ? <p className="cp-quiet">Nothing booked. New invites appear here as Orbis reads them.</p> : groupByDay(upcoming).map((group) => (
            <div key={group.heading} className="cp-agenda-day">
              <h3>{group.heading}</h3>
              <ul>{group.items.map((item) => <AgendaItem key={item.application.id} item={item} selected={selected?.application.id === item.application.id} onSelect={() => setPicked(item.application.id)} />)}</ul>
            </div>
          ))}
        </PanelCard>
        <PastInterviews past={past} />
      </div>
      {selected && <PrepColumn key={selected.application.id} item={selected} />}
    </div>
  );
}
