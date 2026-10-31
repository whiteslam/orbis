'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, ClipboardPaste, Radar, Search, Star, ThumbsDown } from 'lucide-react';
import { listJobsAction, pasteJobAction, runSearchNowAction, setJobStateAction } from '@/app/career/actions';
import { BusyIcon, NoticeLine } from '@/components/career/bits';
import { JobCard } from '@/components/career/job-card';
import { useRun } from '@/components/career/use-run';
import { PASTED_ATS_LABEL, pastedUrlKind } from '@/lib/career/sources/pasted';
import type { CareerJob } from '@/lib/career/types';
import type { JobView } from '@/lib/career/view';

const VIEWS: Array<[JobView, string]> = [['for_you', 'Matches'], ['everything', 'Everything'], ['shortlisted', 'Shortlisted']];
const SEARCH_DELAY_MS = 350;

/** "Not for me", with an optional reason Orbis learns from later. */
function DismissForm({ job, onDone, onCancel }: Readonly<{ job: CareerJob; onDone: (job: CareerJob) => void; onCancel: () => void }>) {
  const id = useId();
  const [reason, setReason] = useState('');
  const { busy, notice, run } = useRun();
  const dismiss = () => run('dismiss', () => setJobStateAction(job.id, 'dismissed', reason.trim() || undefined), (next) => {
    onDone(next);
  });
  return (
    <div className="cr-dismiss">
      <label className="fd-field" htmlFor={id}>
        Why not? <span className="fd-hint">Optional. It teaches Orbis what to skip.</span>
        <input id={id} value={reason} placeholder="Crypto, too junior, needs relocation…" onChange={(event) => setReason(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') void dismiss(); }} />
      </label>
      <div className="fd-act pf-act">
        <button type="button" onClick={dismiss} disabled={busy !== null}>
          <BusyIcon on={busy === 'dismiss'} />
          Hide this job
        </button>
        <button type="button" className="fd-link" onClick={onCancel}>Cancel</button>
      </div>
      <NoticeLine notice={notice} />
    </div>
  );
}

/** Open, Shortlist and Not for me under a job card; the web panel's Jobs page uses it too. */
export function JobActions({ job, onOpen, onChanged }: Readonly<{ job: CareerJob; onOpen: (job: CareerJob) => void; onChanged: (job: CareerJob) => void }>) {
  const [dismissing, setDismissing] = useState(false);
  const { busy, notice, run } = useRun();
  const shortlisted = job.state === 'shortlisted';
  const toggle = () => run('shortlist', () => setJobStateAction(job.id, shortlisted ? 'new' : 'shortlisted'), onChanged);

  if (dismissing) return <DismissForm job={job} onDone={onChanged} onCancel={() => setDismissing(false)} />;
  return (
    <>
      <div className="cr-job-buttons">
        <button type="button" className="cr-btn primary" onClick={() => onOpen(job)}>Open</button>
        <button type="button" className="cr-btn" aria-pressed={shortlisted} onClick={toggle} disabled={busy !== null}>
          <BusyIcon on={busy === 'shortlist'} size={13}><Star size={13} aria-hidden="true" fill={shortlisted ? 'currentColor' : 'none'} /></BusyIcon>
          {shortlisted ? 'Shortlisted' : 'Shortlist'}
        </button>
        <button type="button" className="cr-btn quiet" onClick={() => setDismissing(true)}>
          <ThumbsDown size={13} aria-hidden="true" />
          Not for me
        </button>
      </div>
      <NoticeLine notice={notice} />
    </>
  );
}

/** What the paste form needs besides the link and text: whether the title and company are asked for, and must be given. */
export function pasteNeeds(url: string, text: string): { ats: string | null; names: 'hidden' | 'optional' | 'required' } {
  const link = url.trim();
  const ref = link ? pastedUrlKind(link) : null;
  const ats = ref ? PASTED_ATS_LABEL[ref.kind] : null;
  // An ATS link is read from its API; the names only matter if that read fails and the text stands in.
  if (ats) return { ats, names: text.trim() ? 'optional' : 'hidden' };
  return { ats: null, names: link || text.trim() ? 'required' : 'hidden' };
}

/**
 * A job from anywhere: a link (Greenhouse, Lever, Ashby and Recruitee are
 * read directly) or the pasted text. Any other link, or text alone, needs the
 * job title and company as well (pasteJobAction refuses without them).
 */
export function PasteJob({ onPasted, onClose }: Readonly<{ onPasted: (jobId: string) => void; onClose: () => void }>) {
  const urlId = useId();
  const textId = useId();
  const titleId = useId();
  const companyId = useId();
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const { busy, notice, run } = useRun();
  const needs = pasteNeeds(url, text);
  const missingNames = needs.names === 'required' && (!title.trim() || !company.trim());
  const paste = () => run('paste', () => pasteJobAction({
    url: url.trim() || undefined,
    text: text.trim() || undefined,
    title: needs.names === 'hidden' ? undefined : title.trim() || undefined,
    company: needs.names === 'hidden' ? undefined : company.trim() || undefined,
  }), (data) => {
    onPasted(data.jobId);
  });
  return (
    <section className="mn-card cr-paste-job" aria-labelledby="cr-paste-title">
      <h2 className="fd-label" id="cr-paste-title">Paste a job</h2>
      <label className="fd-field wide" htmlFor={urlId}>
        Link to the listing
        <input id={urlId} type="url" inputMode="url" value={url} placeholder="https://jobs.lever.co/…" onChange={(event) => setUrl(event.currentTarget.value)} />
      </label>
      {needs.ats && <p className="cr-paste-ats"><Check size={13} strokeWidth={2.6} aria-hidden="true" />A {needs.ats} link: Orbis reads the listing from it.</p>}
      <label className="fd-field wide" htmlFor={textId}>
        {needs.ats ? 'The description (only if the link can’t be read)' : 'The description'}
        <textarea id={textId} rows={5} value={text} placeholder="Paste everything from the role to the benefits." onChange={(event) => setText(event.currentTarget.value)} />
      </label>
      {needs.names !== 'hidden' && (
        <fieldset className="cr-paste-names">
          <legend className="sr-only">The job</legend>
          <div className="fd-grid">
            <label className="fd-field" htmlFor={titleId}>
              Job title{needs.names === 'optional' && <span className="fd-hint"> (optional)</span>}
              <input id={titleId} value={title} maxLength={300} autoComplete="off" placeholder="Frontend Engineer" aria-required={needs.names === 'required'} onChange={(event) => setTitle(event.currentTarget.value)} />
            </label>
            <label className="fd-field" htmlFor={companyId}>
              Company{needs.names === 'optional' && <span className="fd-hint"> (optional)</span>}
              <input id={companyId} value={company} maxLength={200} autoComplete="organization" placeholder="Razorpay" aria-required={needs.names === 'required'} onChange={(event) => setCompany(event.currentTarget.value)} />
            </label>
          </div>
          <p className="fd-hint cr-gap-top">
            {needs.names === 'required'
              ? 'Orbis doesn’t read other sites, so say what the job is and who it’s with. The link becomes the apply page.'
              : 'Used only if the link can’t be read and your pasted text stands in for it.'}
          </p>
        </fieldset>
      )}
      {needs.names === 'hidden' && !needs.ats && (
        <p className="fd-hint cr-gap-top">Greenhouse, Lever, Ashby and Recruitee links are read directly. For any other site, add the title and company (and the description if you can); the link becomes the apply page.</p>
      )}
      <div className="fd-act pf-act">
        <button type="button" onClick={paste} disabled={busy !== null || (!url.trim() && !text.trim()) || missingNames}>
          <BusyIcon on={busy === 'paste'} />
          {busy === 'paste' ? 'Reading and scoring…' : 'Add and score'}
        </button>
        <button type="button" className="fd-link" onClick={onClose}>Cancel</button>
      </div>
      <NoticeLine notice={notice} />
    </section>
  );
}

function useJobs(view: JobView, search: string, initial: CareerJob[]) {
  const [jobs, setJobs] = useState<CareerJob[]>(initial);
  const [total, setTotal] = useState<number | null>(null);
  const { busy, notice, run } = useRun();
  const [reloads, setReloads] = useState(0);
  const first = useRef(true);
  // Jobs a reload (a paste, a search) brought in that weren't on screen before;
  // only they animate in. Switching views or searching never marks any.
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const reloading = useRef(false);
  const shown = useRef(jobs);
  useEffect(() => {
    shown.current = jobs;
  }, [jobs]);

  useEffect(() => {
    // The For you list opens on the home's top matches; the full list replaces them when it lands.
    const delay = first.current ? 0 : SEARCH_DELAY_MS;
    first.current = false;
    const timer = setTimeout(() => {
      const marking = reloading.current;
      reloading.current = false;
      void run('list', () => listJobsAction({ view, search: search.trim() || undefined }), (page) => {
        if (marking) {
          const before = new Set(shown.current.map((job) => job.id));
          setFresh(new Set(page.jobs.filter((job) => !before.has(job.id)).map((job) => job.id)));
        }
        setJobs(page.jobs);
        setTotal(page.total);
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [view, search, run, reloads]);

  const reload = () => {
    reloading.current = true;
    setReloads((count) => count + 1);
  };
  return { jobs, setJobs, total, fresh, loading: busy === 'list', notice, reload };
}

/**
 * For you: matches at or above the owner's bar, with Everything and
 * Shortlisted beside it, a search, "Paste a job" and "Run a search now".
 */
export function ForYouView({ initial, threshold, onOpen, onOpenJobId, languages = [] }: Readonly<{
  /** The owner's languages, for each job's fit check. */
  languages?: readonly string[];
  /** The home's top matches, shown at once while the full list loads. */
  initial: CareerJob[];
  threshold: number | null;
  onOpen: (job: CareerJob) => void;
  onOpenJobId: (jobId: string) => void;
}>) {
  const searchId = useId();
  const [view, setView] = useState<JobView>('for_you');
  const [search, setSearch] = useState('');
  const [pasting, setPasting] = useState(false);
  const { jobs, setJobs, total, fresh, loading, notice: listNotice, reload } = useJobs(view, search, initial);
  const searchRun = useRun();

  const changed = (next: CareerJob) => setJobs((current) => {
    const leaves = next.state === 'dismissed' || (view === 'shortlisted' && next.state !== 'shortlisted');
    return leaves ? current.filter((job) => job.id !== next.id) : current.map((job) => (job.id === next.id ? next : job));
  });

  const runSearch = () => searchRun.run('search', () => runSearchNowAction(), (counts) => {
    reload();
    return `Found ${counts.found} new, scored ${counts.scored}, drafted ${counts.drafted}.`;
  });

  return (
    <div className="cr-view">
      <div className="cr-tools">
        <div className="so-mini" role="radiogroup" aria-label="Which jobs">
          {VIEWS.map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={view === id} onClick={() => setView(id)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="cr-search">
        <Search size={15} aria-hidden="true" />
        <label htmlFor={searchId} className="sr-only">Search jobs</label>
        <input id={searchId} type="search" value={search} placeholder="Title, company or skill" onChange={(event) => setSearch(event.currentTarget.value)} />
      </div>
      <div className="so-actions cr-actions">
        <button type="button" className="so-action" onClick={() => setPasting((open) => !open)} aria-expanded={pasting}>
          <span className="so-action-icon" aria-hidden="true"><ClipboardPaste size={16} strokeWidth={2} /></span>
          <span className="so-action-text"><b>Paste a job</b><small>A link or its text</small></span>
        </button>
        <button type="button" className="so-action" onClick={runSearch} disabled={searchRun.busy !== null}>
          <span className="so-action-icon" aria-hidden="true"><BusyIcon on={searchRun.busy === 'search'} size={16}><Radar size={16} strokeWidth={2} /></BusyIcon></span>
          <span className="so-action-text"><b>{searchRun.busy === 'search' ? 'Searching…' : 'Run a search now'}</b><small>All your sources</small></span>
        </button>
      </div>
      <NoticeLine notice={searchRun.notice} />
      {pasting && <PasteJob onClose={() => setPasting(false)} onPasted={(jobId) => { setPasting(false); reload(); onOpenJobId(jobId); }} />}

      {listNotice && <p className="cr-quiet-error">The full list didn’t load: {listNotice.text}</p>}
      <p className="cr-count" aria-live="polite">{loading ? 'Loading…' : countLine(view, total ?? jobs.length)}</p>

      {jobs.length === 0 && !loading ? <EmptyJobs view={view} searching={Boolean(search.trim())} /> : (
        <div className="cr-jobs">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} threshold={threshold} languages={languages} isNew={fresh.has(job.id)} onOpen={onOpen} actions={<JobActions job={job} onOpen={onOpen} onChanged={changed} />} />
          ))}
        </div>
      )}
    </div>
  );
}

function countLine(view: JobView, count: number) {
  if (view === 'shortlisted') return count === 1 ? '1 shortlisted job' : `${count} shortlisted jobs`;
  if (view === 'everything') return count === 1 ? '1 job, best first' : `${count} jobs, best first`;
  return count === 1 ? '1 match above your bar' : `${count} matches above your bar`;
}

function EmptyJobs({ view, searching }: Readonly<{ view: JobView; searching: boolean }>) {
  if (searching) return <p className="fd-empty">No jobs match that search.</p>;
  if (view === 'shortlisted') return <p className="fd-empty">Nothing shortlisted yet. Star a job to keep it here.</p>;
  return (
    <section className="fd-focus cr-empty">
      <h2>No new matches above your bar.</h2>
      <p>Orbis searches every few hours. Run a search now, look through Everything, or lower your bar in Setup.</p>
    </section>
  );
}
