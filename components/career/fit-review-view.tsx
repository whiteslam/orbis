'use client';

import { reviewFit, skillsToBuild, type FitGate, type FitReview } from '@/lib/career/fit-review';
import type { CareerJob } from '@/lib/career/types';

/** The worst gate's tone: a fail outranks a flag; a list without either has none. */
function gateTone(review: FitReview): 'fail' | 'flag' | null {
  if (review.gates.some((gate) => gate.verdict === 'fail')) return 'fail';
  if (review.gates.some((gate) => gate.verdict === 'flag')) return 'flag';
  return null;
}

const GATE_NAME: Record<FitGate['id'], string> = { eligibility: 'Eligibility', language: 'Language', integrity: 'Posting' };

/**
 * The fit review as a job's lead (the sheet and the panel's drawer): the
 * verdict and what to do, big and plain; any gate as a quiet line with the
 * posting's own words; what to lead with and what to address; and the
 * questions for the employer on demand. Text and rows, no boxes.
 */
export function FitLead({ job, languages }: Readonly<{ job: CareerJob; languages: readonly string[] }>) {
  const review = reviewFit(job, { languages: [...languages] });
  return (
    <section className="cr-fit" aria-labelledby="cr-fit-title">
      <h2 className="cr-fit-verdict" id="cr-fit-title" data-verdict={review.verdict ?? 'none'}>
        <b>{review.label}.</b> {review.advice}
      </h2>
      {review.gates.length > 0 && (
        <ul className="cr-fit-gates" aria-label="Checks on the posting">
          {review.gates.map((gate) => (
            <li key={gate.id} className={`cr-fit-gate ${gate.verdict}`}>
              <i aria-hidden="true" />
              <span>
                <b>{GATE_NAME[gate.id]}{gate.verdict === 'fail' ? ', fails' : ', check'}: </b>{gate.note}
                {gate.quote && <q>{gate.quote}</q>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {(review.strengths.length > 0 || review.gaps.length > 0) && (
        <div className="cr-fit-cols">
          {review.strengths.length > 0 && (
            <div>
              <h3>Lead with</h3>
              <ul>{review.strengths.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
          {review.gaps.length > 0 && (
            <div>
              <h3>Address</h3>
              <ul>{review.gaps.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      {review.questions.length > 0 && (
        <details className="cr-fit-questions">
          <summary>Questions to ask the employer</summary>
          <ul>{review.questions.map((question) => <li key={question}>{question}</li>)}</ul>
        </details>
      )}
    </section>
  );
}

/** A job list's triage mark: the verdict word, and a gold or red dot when a gate flags or fails. */
export function FitTag({ job, languages = [] }: Readonly<{ job: CareerJob; languages?: readonly string[] }>) {
  const review = reviewFit(job, { languages: [...languages] });
  const tone = gateTone(review);
  if (!review.verdict && !tone) return null;
  return (
    <span className="cr-fit-tag" data-verdict={review.verdict ?? 'none'}>
      {review.label}
      {tone && <i className={`cr-fit-dot ${tone}`} title={tone === 'fail' ? 'A check on the posting fails' : 'A check on the posting needs a look'} aria-hidden="true" />}
      {tone && <span className="sr-only">{tone === 'fail' ? ', a check on the posting fails' : ', a check on the posting needs a look'}</span>}
    </span>
  );
}

/** Skills to build: the must-haves missing most often across your good matches, each with its jobs on demand. Hidden when there are none. */
export function SkillsToBuild({ jobs }: Readonly<{ jobs: readonly CareerJob[] }>) {
  const seen = new Set<string>();
  const unique = jobs.filter((job) => (seen.has(job.id) ? false : (seen.add(job.id), true)));
  const skills = skillsToBuild(unique);
  if (skills.length === 0) return null;
  return (
    <section className="cr-build" aria-labelledby="cr-build-title">
      <h2 className="cr-h" id="cr-build-title">Skills to build</h2>
      <p className="cr-sub">The must-haves you are missing most often in matches worth applying to.</p>
      <ul>
        {skills.map((item) => (
          <li key={item.skill}>
            <details>
              <summary><b>{item.skill}</b><span>missing in {item.jobs} of your good matches</span></summary>
              <ul>{item.titles.map((title) => <li key={title}>{title}</li>)}</ul>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
