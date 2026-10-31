import type { ReactNode } from 'react';
import { Check, Circle, CircleDot, ExternalLink, MapPin } from 'lucide-react';
import { SafeLink } from '@/components/career/bits';
import { FitTag } from '@/components/career/fit-review-view';
import { ScoreRing } from '@/components/career/score-ring';
import { creditFor, freshness, salaryText } from '@/components/career/format';
import type { CareerJob, MatchLine } from '@/lib/career/types';

/** The best three met requirements (musts first) and the most important missing one. */
export function topLines(job: Pick<CareerJob, 'match'>): { met: MatchLine[]; missing: MatchLine | null } {
  const lines = job.match?.lines ?? [];
  // Full matches before partial ones, must-haves before nice-to-haves.
  const rank = (line: MatchLine) => (line.verdict === 'met' ? 0 : 2) + (line.kind === 'must' ? 0 : 1);
  const met = lines.filter((line) => line.verdict !== 'missing').sort((left, right) => rank(left) - rank(right)).slice(0, 3);
  const missing = lines.filter((line) => line.verdict === 'missing').sort((left, right) => rank(left) - rank(right))[0] ?? null;
  return { met, missing };
}

function where(job: Pick<CareerJob, 'location' | 'remote'>) {
  if (job.remote && job.location) return `Remote, ${job.location}`;
  if (job.remote) return 'Remote';
  return job.location;
}

/** One requirement as a token: an icon and the word, so met and partial differ without colour. */
export function RequirementToken({ line }: Readonly<{ line: MatchLine }>) {
  const years = line.requirement.years ? ` ${line.requirement.years}y` : '';
  if (line.verdict === 'met') return <li className="cr-req met"><Check size={11} strokeWidth={3} aria-hidden="true" /><span>{line.requirement.skill}{years}</span></li>;
  if (line.verdict === 'partial') return <li className="cr-req partial"><CircleDot size={11} strokeWidth={2.4} aria-hidden="true" /><span>{line.requirement.skill}{years}<span className="sr-only">, partly</span></span></li>;
  return <li className="cr-req missing"><Circle size={11} strokeWidth={2.4} aria-hidden="true" /><span><span className="sr-only">Missing: </span>{line.requirement.skill}{years}</span></li>;
}

/**
 * A job as every list shows it: the score ring, the title and company, the
 * source's credit (linking back, as the sources require), what the profile
 * meets and the biggest gap, the salary when known, how fresh it is, and a
 * "thin" badge when only an alert's title and line are known.
 *
 * Presentational: actions arrive through the `actions` slot.
 */
export function JobCard({ job, threshold = null, onOpen, actions, now, languages = [], isNew = false }: Readonly<{
  job: CareerJob;
  /** The owner's bar, marked on the ring. */
  threshold?: number | null;
  /** Opens the application sheet; the title becomes a button. */
  onOpen?: (job: CareerJob) => void;
  actions?: ReactNode;
  /** For stable rendering in tests and previews. */
  now?: Date;
  /** The owner's languages, for the fit review's language check. */
  languages?: readonly string[];
  /** Just arrived (a paste or a search found it): it rises into the list. */
  isNew?: boolean;
}>) {
  const { met, missing } = topLines(job);
  const salary = salaryText(job.salary ?? job.requirements?.salary ?? null);
  const fresh = freshness(job, now);
  const place = where(job);
  const below = threshold !== null && job.score !== null && job.score < threshold;

  return (
    <article className={`cr-job${below ? ' below' : ''}${isNew ? ' is-new' : ''}`} aria-labelledby={`job-${job.id}`}>
      <div className="cr-job-top">
        <ScoreRing score={job.score} threshold={threshold} lowConfidence={job.thin || job.match?.confidence === 'low'} />
        <div className="cr-job-head">
          <h3 id={`job-${job.id}`}>
            {onOpen ? <button type="button" onClick={() => onOpen(job)}>{job.title}</button> : job.title}
          </h3>
          <p className="cr-job-company">{job.company}<FitTag job={job} languages={languages} /></p>
          <p className="cr-job-meta">
            {place && <span><MapPin size={11} aria-hidden="true" />{place}</span>}
            <span className={fresh.stale ? 'stale' : undefined}>{fresh.text}</span>
            {job.thin && <span className="cr-thin" title="Only the alert’s title and a line are known">Thin listing</span>}
          </p>
        </div>
      </div>

      {(met.length > 0 || missing) && (
        <ul className="cr-reqs" aria-label="How you match">
          {met.map((line) => <RequirementToken key={`${line.kind}-${line.requirement.skill}`} line={line} />)}
          {missing && <RequirementToken line={missing} />}
        </ul>
      )}

      {job.match?.excluded && <p className="cr-job-excluded">Excluded: {job.match.excluded}</p>}

      <div className="cr-job-foot">
        {salary ? <span className="cr-salary">{salary}</span> : <span className="cr-salary none">Salary not stated</span>}
        <SafeLink className="cr-credit" url={job.url}>
          {creditFor(job)}<ExternalLink size={10} aria-hidden="true" />
        </SafeLink>
      </div>

      {actions && <div className="cr-job-actions">{actions}</div>}
    </article>
  );
}
