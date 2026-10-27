import { Check, Circle, CircleDot } from 'lucide-react';
import { ScoreRing } from '@/components/career/score-ring';
import { replyChance, scoreBand } from '@/components/career/format';
import type { CareerJob, MatchLine, Prediction, RequirementVerdict } from '@/lib/career/types';

const VERDICT_TITLE: Record<RequirementVerdict, string> = { met: 'You have', partial: 'Partly', missing: 'Missing' };
const VERDICT_ORDER: RequirementVerdict[] = ['met', 'partial', 'missing'];

function VerdictIcon({ verdict }: Readonly<{ verdict: RequirementVerdict }>) {
  if (verdict === 'met') return <Check size={12} strokeWidth={3} aria-hidden="true" />;
  if (verdict === 'partial') return <CircleDot size={12} strokeWidth={2.4} aria-hidden="true" />;
  return <Circle size={12} strokeWidth={2.4} aria-hidden="true" />;
}

function Reason({ line }: Readonly<{ line: MatchLine }>) {
  const years = line.requirement.years ? `, ${line.requirement.years}+ years` : '';
  return (
    <li className={`cr-reason ${line.verdict}`}>
      <VerdictIcon verdict={line.verdict} />
      <span>
        <b>{line.requirement.skill}{years}</b>
        {line.kind === 'nice' && <em> nice to have</em>}
        {line.note && <small>{line.note}</small>}
      </span>
    </li>
  );
}

/** Where the score's points came from, in the order the formula weighs them. */
function Parts({ parts }: Readonly<{ parts: NonNullable<CareerJob['match']>['parts'] }>) {
  const rows: Array<[string, number, number]> = [
    ['Must-haves', parts.must, 60],
    ['Extras', parts.nice, 20],
    ['Experience', parts.experience, 10],
    ['Role fit', parts.role, 10],
  ];
  return (
    <dl className="cr-parts">
      {rows.map(([label, value, of]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd><b>{Math.round(value)}</b>/{of}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The score, where its points came from, each requirement's verdict and why, and the reply chance. */
export function MatchSummary({ job, threshold, prediction }: Readonly<{ job: CareerJob; threshold: number | null; prediction: Prediction | null }>) {
  const lines = job.match?.lines ?? [];
  const chance = replyChance(prediction);
  const rough = job.thin || job.match?.confidence === 'low';
  const above = threshold !== null && job.score !== null && job.score >= threshold;
  return (
    <section className="cr-match" aria-labelledby="cr-match-title">
      <h2 className="sr-only" id="cr-match-title">How you match</h2>
      <div className="cr-match-top">
        <ScoreRing score={job.score} size="lg" threshold={threshold} lowConfidence={rough} showWord />
        <div className="cr-match-side">
          <p className="cr-match-line">
            {scoreBand(job.score).word}
            {threshold !== null && job.score !== null && <span>{above ? `, above your bar of ${threshold}` : `, under your bar of ${threshold}`}</span>}
          </p>
          {rough && <p className="cr-match-rough">Scored on a short listing. Paste the full description for a firmer score.</p>}
          {chance && (
            <p className="cr-chance">
              <b>{chance.text}</b>
              <small>{chance.note}</small>
            </p>
          )}
        </div>
      </div>
      {job.match && <Parts parts={job.match.parts} />}
      {job.match?.excluded && <p className="fd-msg bad">Excluded by your spec: {job.match.excluded}</p>}
      {VERDICT_ORDER.map((verdict) => {
        const group = lines.filter((line) => line.verdict === verdict);
        if (!group.length) return null;
        return (
          <div className="cr-reasons" key={verdict}>
            <h3>{VERDICT_TITLE[verdict]} <span>{group.length}</span></h3>
            <ul>{group.map((line) => <Reason key={`${line.kind}-${line.requirement.skill}`} line={line} />)}</ul>
          </div>
        );
      })}
      {!job.match && <p className="fd-empty">This job hasn’t been scored yet.</p>}
    </section>
  );
}
