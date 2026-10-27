'use client';

import { useEffect, useId, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { draftApplicationAction, rescoreJobAction } from '@/app/career/actions';
import { BusyIcon, NoticeLine } from '@/components/career/bits';
import { useRun } from '@/components/career/use-run';
import type { CareerJob } from '@/lib/career/types';
import type { ApplicationDetail } from '@/lib/career/view';

// What tailoring is doing, roughly by when. The action is one call, so this is
// pacing, not a live feed; it stops at the last step until the answer lands.
const STAGES: Array<[number, string]> = [
  [0, 'Reading the job against your profile'],
  [7, 'Tailoring your resume and cover note'],
  [17, 'Checking every line against your facts'],
  [25, 'Rendering the PDF and DOCX, and the ATS check'],
];
const EXPECTED_SECONDS = 32;

function useElapsed(active: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 500);
    return () => {
      clearInterval(timer);
      setSeconds(0);
    };
  }, [active]);
  return seconds;
}

/** While a draft is being written: the step it's likely on, and a bar that never claims to be done. */
function DraftProgress({ seconds }: Readonly<{ seconds: number }>) {
  const stage = [...STAGES].reverse().find(([from]) => seconds >= from)?.[1] ?? STAGES[0][1];
  const share = Math.min(0.92, seconds / EXPECTED_SECONDS);
  return (
    <div className="cr-progress">
      <div className="cr-progress-bar" aria-hidden="true"><i style={{ transform: `scaleX(${Math.max(0.04, share)})` }} /></div>
      <output>{stage}… <span className="cr-progress-time">{seconds}s</span></output>
      <p className="fd-hint">This usually takes about half a minute. You can keep this open or come back later.</p>
    </div>
  );
}

/** A thin job (from an alert) asks for its full description before Orbis tailors anything to it. */
function ThinBox({ job, onJob }: Readonly<{ job: CareerJob; onJob: (job: CareerJob) => void }>) {
  const id = useId();
  const [text, setText] = useState('');
  const { busy, notice, run } = useRun();
  const rescore = () => run('rescore', () => rescoreJobAction(job.id, text.trim()), (next) => {
    onJob(next);
    return 'Rescored on the full description.';
  });
  return (
    <div className="cr-thinbox">
      <label className="fd-field" htmlFor={id}>
        Paste the full description
        <textarea id={id} rows={6} value={text} onChange={(event) => setText(event.currentTarget.value)} placeholder="Open the listing, copy everything from the role to the benefits, and paste it here." />
      </label>
      <p className="fd-hint">The alert only gave a title and a line. With the full text, the score firms up and the resume is tailored to what they actually ask for.</p>
      <div className="fd-act pf-act">
        <button type="button" onClick={rescore} disabled={busy !== null || text.trim().length < 80}>
          <BusyIcon on={busy === 'rescore'}><RefreshCw size={14} aria-hidden="true" /></BusyIcon>
          Rescore with this
        </button>
      </div>
      <NoticeLine notice={notice} />
    </div>
  );
}

/** No application yet: draft one (with the thin-job step first when it applies). */
export function DraftStart({ job, onDetail, onJob }: Readonly<{ job: CareerJob; onDetail: (detail: ApplicationDetail) => void; onJob: (job: CareerJob) => void }>) {
  const { busy, notice, run } = useRun();
  const drafting = busy === 'draft';
  const seconds = useElapsed(drafting);
  const [skipThin, setSkipThin] = useState(false);
  const draft = () => run('draft', () => draftApplicationAction(job.id), (detail) => {
    onDetail(detail);
  });
  const askThin = job.thin && !skipThin;

  return (
    <section className="cr-block cr-draft-start" aria-labelledby="cr-draft-title">
      <h2 className="fd-label" id="cr-draft-title">Application</h2>
      {askThin ? (
        <>
          <ThinBox job={job} onJob={onJob} />
          <button type="button" className="fd-link cr-skip" onClick={() => setSkipThin(true)}>Draft from the short listing anyway</button>
        </>
      ) : (
        <>
          <p className="cr-block-note">Orbis tailors your resume to this job using only what’s in your profile, writes a short cover note and the screening answers, then checks every line. Nothing is sent until you press Send.</p>
          {drafting ? <DraftProgress seconds={seconds} /> : (
            <div className="fd-act">
              <button type="button" onClick={draft} disabled={busy !== null}>
                <Sparkles size={15} aria-hidden="true" />
                Draft application
              </button>
            </div>
          )}
        </>
      )}
      <NoticeLine notice={notice} />
    </section>
  );
}
