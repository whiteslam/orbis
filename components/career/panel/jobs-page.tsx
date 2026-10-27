'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { listJobsAction } from '@/app/career/actions';
import { daysSince, SOURCE_NAME } from '@/components/career/format';
import { JobActions } from '@/components/career/for-you-view';
import { JobCard } from '@/components/career/job-card';
import { useRun } from '@/components/career/use-run';
import { MiniSwitch } from '@/components/career/panel/panel-bits';
import { usePanel } from '@/components/career/panel/panel-context';
import { SOURCE_IDS, type CareerJob, type SourceId } from '@/lib/career/types';
import type { CareerHome, JobFilters, JobView } from '@/lib/career/view';

const VIEWS: ReadonlyArray<readonly [JobView, string]> = [['for_you', 'For you'], ['everything', 'Everything'], ['shortlisted', 'Shortlisted']];
const SCORES: ReadonlyArray<readonly [string, string]> = [['0', 'Any match'], ['30', '30 and up'], ['50', '50 and up'], ['70', '70 and up'], ['80', '80 and up']];
const SEARCH_DELAY_MS = 350;
const PAGE = 30;

type Filters = { view: JobView; search: string; source: SourceId | ''; minScore: number; remoteOnly: boolean; fresh: boolean };

/** The filters the server can't apply (fresh) and, when the list fell back to the home's matches, all of them. */
function applyLocally(jobs: readonly CareerJob[], filters: Filters, everything: boolean): CareerJob[] {
  const words = filters.search.toLowerCase().split(/\s+/).filter(Boolean);
  return jobs.filter((job) => {
    if (filters.fresh && daysSince(job.postedAt ?? job.foundAt) > 3) return false;
    if (!everything) return true;
    if (filters.source && job.source !== filters.source) return false;
    if (filters.remoteOnly && !job.remote) return false;
    if (filters.minScore && (job.score ?? 0) < filters.minScore) return false;
    if (filters.view === 'shortlisted' && job.state !== 'shortlisted') return false;
    return words.every((word) => `${job.title} ${job.company}`.toLowerCase().includes(word));
  });
}

function useJobList(filters: Filters, fallback: CareerJob[], onJobs: (jobs: CareerJob[]) => void) {
  const [jobs, setJobs] = useState<CareerJob[]>(fallback);
  const [total, setTotal] = useState<number | null>(null);
  const { busy, notice, run } = useRun();
  const first = useRef(true);
  const report = useRef(onJobs);
  useEffect(() => {
    report.current = onJobs;
  }, [onJobs]);
  const { view, search, source, remoteOnly, minScore } = filters;

  const load = (offset: number) => {
    const query: JobFilters = { view, search: search.trim() || undefined, source: source || undefined, remoteOnly: remoteOnly || undefined, minScore: minScore || undefined, offset: offset || undefined };
    return run(offset ? 'more' : 'list', () => listJobsAction(query), (page) => {
      setJobs((current) => (offset ? [...current, ...page.jobs] : page.jobs));
      setTotal(page.total);
      report.current(page.jobs);
    });
  };

  useEffect(() => {
    const delay = first.current ? 0 : SEARCH_DELAY_MS;
    first.current = false;
    const timer = setTimeout(() => void load(0), delay);
    return () => clearTimeout(timer);
    // `load` closes over these filters; listing them is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, search, source, remoteOnly, minScore]);

  const failed = notice && !notice.ok ? notice.text : null;
  return { jobs, setJobs, total, failed, busy, more: () => void load(jobs.length) };
}

function FilterBar({ filters, set }: Readonly<{ filters: Filters; set: (patch: Partial<Filters>) => void }>) {
  const searchId = useId();
  const sourceId = useId();
  const scoreId = useId();
  return (
    <div className="cp-toolbar cp-jobs-tools">
      <MiniSwitch label="Which jobs" value={filters.view} options={VIEWS} onChange={(view) => set({ view })} />
      <div className="cp-search">
        <Search size={16} aria-hidden="true" />
        <label htmlFor={searchId} className="sr-only">Search jobs</label>
        <input id={searchId} type="search" value={filters.search} placeholder="Title, company or skill" onChange={(event) => set({ search: event.currentTarget.value })} />
      </div>
      <label className="cp-select" htmlFor={sourceId}>
        <span className="sr-only">Source</span>
        <select id={sourceId} value={filters.source} onChange={(event) => set({ source: event.currentTarget.value as SourceId | '' })}>
          <option value="">All sources</option>
          {SOURCE_IDS.map((id) => <option key={id} value={id}>{SOURCE_NAME[id]}</option>)}
        </select>
      </label>
      <label className="cp-select" htmlFor={scoreId}>
        <span className="sr-only">Lowest match score</span>
        <select id={scoreId} value={String(filters.minScore)} onChange={(event) => set({ minScore: Number(event.currentTarget.value) })}>
          {SCORES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="cp-check"><input type="checkbox" checked={filters.remoteOnly} onChange={(event) => set({ remoteOnly: event.currentTarget.checked })} />Remote only</label>
      <label className="cp-check"><input type="checkbox" checked={filters.fresh} onChange={(event) => set({ fresh: event.currentTarget.checked })} />Posted in 3 days</label>
    </div>
  );
}

function countLine(view: JobView, shown: number, total: number | null) {
  const of = total !== null && total > shown ? ` of ${total}` : '';
  if (view === 'shortlisted') return `${shown}${of} shortlisted`;
  if (view === 'everything') return `${shown}${of} jobs, best first`;
  return `${shown}${of} matches above your bar`;
}

/** Jobs: the tab's For you list, wide, with filters, and each job's detail in the side drawer. */
export function JobsPage({ home, onJobs }: Readonly<{ home: CareerHome; onJobs: (jobs: CareerJob[]) => void }>) {
  const { openJob, sheet } = usePanel();
  const [filters, setFilters] = useState<Filters>({ view: 'for_you', search: '', source: '', minScore: 0, remoteOnly: false, fresh: false });
  const list = useJobList(filters, home.hotMatches, onJobs);
  const set = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }));
  const shown = applyLocally(list.jobs, filters, list.failed !== null);

  const changed = (next: CareerJob) => list.setJobs((current) => {
    const leaves = next.state === 'dismissed' || (filters.view === 'shortlisted' && next.state !== 'shortlisted');
    return leaves ? current.filter((job) => job.id !== next.id) : current.map((job) => (job.id === next.id ? next : job));
  });

  return (
    <div className="cp-jobs">
      <FilterBar filters={filters} set={set} />
      {list.failed && <p className="cp-quiet-error">The full list didn’t load: {list.failed} Showing your top matches from the overview instead.</p>}
      <p className="cp-count-line" aria-live="polite">{list.busy === 'list' ? 'Loading…' : countLine(filters.view, shown.length, list.failed ? null : list.total)}</p>
      {shown.length === 0 && list.busy !== 'list' ? (
        <p className="cp-quiet">No jobs match these filters. Loosen one, look through Everything, or lower your bar in Setup.</p>
      ) : (
        <div className="cp-job-grid">
          {shown.map((job) => (
            <JobCard key={job.id} job={job} threshold={sheet.threshold} onOpen={(picked) => openJob(picked)} actions={<JobActions job={job} onOpen={(picked) => openJob(picked)} onChanged={changed} />} />
          ))}
        </div>
      )}
      {!list.failed && list.total !== null && list.jobs.length < list.total && (
        <div className="cp-more">
          <button type="button" className="cr-btn" onClick={list.more} disabled={list.busy !== null}>{list.busy === 'more' ? 'Loading…' : `Show ${Math.min(PAGE, list.total - list.jobs.length)} more`}</button>
        </div>
      )}
    </div>
  );
}
