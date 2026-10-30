// A job's fit, said the way a careers adviser would say it: a verdict, what to
// do about it, the checks that can rule a job out before any score matters, the
// strengths to lead with, the gaps to address, and what to ask the employer.
// Deterministic, from what scoring already stored; no model is called.
//
// The verdict bands, the eligibility and language gates, and the questions come
// from the job evaluation framework in ai-job-search (MIT,
// github.com/ai-job-search-dev/ai-job-search, 04-job-evaluation.md), adapted:
// Orbis does not know the owner's citizenship, so an eligibility requirement is
// a flag with the posting's own words, never a silent veto.

import type { CareerJob, CareerProfile, MatchLine } from './types.ts';
import { cleanPosting, reviewPosting } from './posting-guard.ts';

export type FitVerdict = 'strong' | 'good' | 'moderate' | 'weak' | 'poor';
export type GateVerdict = 'pass' | 'flag' | 'fail';

export type FitGate = {
  id: 'eligibility' | 'language' | 'integrity';
  verdict: GateVerdict;
  /** One plain line for the owner. */
  note: string;
  /** The posting's own words, when a line of it decided the gate. */
  quote: string | null;
};

export type FitReview = {
  verdict: FitVerdict | null;
  label: string;
  /** What to do, in one sentence. */
  advice: string;
  /** Only gates with something to say: a clean pass is not listed. */
  gates: FitGate[];
  strengths: string[];
  gaps: string[];
  questions: string[];
};

export const VERDICT_BANDS: ReadonlyArray<{ min: number; verdict: FitVerdict; label: string; advice: string }> = [
  { min: 75, verdict: 'strong', label: 'Strong fit', advice: 'Apply, and tailor everything to it.' },
  { min: 60, verdict: 'good', label: 'Good fit', advice: 'Apply, and answer the gaps in your note.' },
  { min: 45, verdict: 'moderate', label: 'Moderate fit', advice: 'Worth it only if the role really draws you.' },
  { min: 30, verdict: 'weak', label: 'Weak fit', advice: 'Probably skip, unless there is a reason beyond the listing.' },
  { min: 0, verdict: 'poor', label: 'Poor fit', advice: 'Skip this one.' },
];

export function verdictFor(score: number) {
  return VERDICT_BANDS.find((band) => score >= band.min) ?? VERDICT_BANDS[VERDICT_BANDS.length - 1];
}

const SENTENCE = /[^.\n!?]+[.!?]?/g;

/** The sentence of the posting that a pattern matched, trimmed for quoting. */
function quoteOf(text: string, pattern: RegExp): string | null {
  for (const sentence of text.match(SENTENCE) ?? []) {
    if (pattern.test(sentence)) return sentence.trim().slice(0, 180);
  }
  return null;
}

const CITIZENSHIP = /\b(?:must be|only)\b[^.\n]{0,40}\bcitizens?\b|\bcitizenship (?:is )?required\b|\b(?:U\.?S\.?|UK|EU|Australian|Canadian|Indian) citizens? only\b|\bpermanent residen(?:t|cy)\b|\bgreen card\b/i;
const CLEARANCE = /\bsecurity clearance\b|\b(?:TS\/SCI|top secret|DV|SC) clearance\b|\bclearance (?:is )?required\b|\bclearable\b/i;
const NO_SPONSOR = /\b(?:no|not|unable to|cannot|can['’]?t|will not|won['’]?t|do not|does not)\b[^.\n]{0,25}\bsponsor|\bwithout (?:visa |employer )?sponsorship\b|\bmust (?:already )?(?:be )?(?:legally )?authori[sz]ed to work\b/i;
const SPONSORS = /\bvisa sponsorship (?:is )?(?:available|provided|offered)\b|\bwe (?:can |will |do )?sponsor\b|\bsponsorship (?:is )?available\b|\binternational applicants (?:are )?welcome\b|\bvisa support\b/i;

/** Eligibility: who may hold the job at all. Orbis can't know the owner's status, so it flags with the posting's words. */
export function eligibilityGate(text: string): FitGate | null {
  const citizenship = quoteOf(text, CITIZENSHIP);
  if (citizenship) return { id: 'eligibility', verdict: 'flag', note: 'Asks for citizenship or residency. Check you qualify before you apply.', quote: citizenship };
  const clearance = quoteOf(text, CLEARANCE);
  if (clearance) return { id: 'eligibility', verdict: 'flag', note: 'Needs a security clearance, which usually depends on citizenship.', quote: clearance };
  const noSponsor = quoteOf(text, NO_SPONSOR);
  if (noSponsor) return { id: 'eligibility', verdict: 'flag', note: 'No visa sponsorship. Apply only if you can already work there.', quote: noSponsor };
  const sponsors = quoteOf(text, SPONSORS);
  if (sponsors) return { id: 'eligibility', verdict: 'pass', note: 'Open to applicants who need a visa.', quote: sponsors };
  return null;
}

const LANGUAGES = [
  'English', 'Hindi', 'German', 'French', 'Spanish', 'Portuguese', 'Italian', 'Dutch', 'Japanese', 'Mandarin', 'Chinese', 'Cantonese',
  'Korean', 'Arabic', 'Russian', 'Polish', 'Swedish', 'Danish', 'Norwegian', 'Finnish', 'Turkish', 'Hebrew', 'Bengali', 'Tamil',
  'Telugu', 'Marathi', 'Kannada', 'Malayalam', 'Gujarati', 'Punjabi', 'Urdu', 'Czech', 'Greek', 'Indonesian', 'Vietnamese', 'Thai',
  'Ukrainian', 'Romanian', 'Hungarian',
];
const LEVEL = /\b(?:fluent|fluency|native|mother tongue|proficien(?:t|cy)|business[- ](?:level|fluent)|working knowledge|bilingual|[BC][12]\b|must speak|written and spoken|spoken and written|required)/i;

/**
 * Language: what the role needs spoken, against the owner's languages. English
 * is assumed (Orbis itself is in English). A language the owner doesn't list
 * fails, quoting the posting; an empty list only flags, since the owner may not
 * have filled it in.
 */
export function languageGate(text: string, spoken: readonly string[]): FitGate | null {
  const known = new Set(['english', ...spoken.map((item) => item.toLowerCase())].flatMap((item) => item.split(/[^a-z]+/)).filter(Boolean));
  for (const sentence of text.match(SENTENCE) ?? []) {
    if (!LEVEL.test(sentence)) continue;
    for (const language of LANGUAGES) {
      if (language === 'English' || !new RegExp(`\\b${language}\\b`).test(sentence)) continue;
      if (known.has(language.toLowerCase()) || (language === 'Mandarin' && known.has('chinese')) || (language === 'Chinese' && known.has('mandarin'))) continue;
      const quote = sentence.trim().slice(0, 180);
      return spoken.length
        ? { id: 'language', verdict: 'fail', note: `Needs ${language}, which isn't one of your languages.`, quote }
        : { id: 'language', verdict: 'flag', note: `Needs ${language}. Add your languages to your profile so Orbis can check.`, quote };
    }
  }
  return null;
}

function lineText(line: MatchLine) {
  return line.note ? `${line.requirement.skill}: ${line.note}` : line.requirement.skill;
}

/** Questions worth a call or an email before applying, when the listing leaves them open. */
function questionsFor(job: Pick<CareerJob, 'description' | 'match' | 'requirements'>, gaps: number): string[] {
  const out: string[] = [];
  const listed = (job.requirements?.mustHave.length ?? 0) + (job.requirements?.niceToHave.length ?? 0);
  if (listed > 8 || gaps > 0) out.push('Which of the listed skills matter most in the first six months?');
  if ((job.description ?? '').length < 1500 || job.match?.confidence === 'low') out.push('How is the time split across the responsibilities, day to day?');
  out.push('What would success look like after six to twelve months?');
  return out.slice(0, 3);
}

/** The whole review for one job. */
export function reviewFit(job: Pick<CareerJob, 'score' | 'match' | 'description' | 'requirements' | 'thin'>, profile: Pick<CareerProfile, 'languages'>): FitReview {
  const text = cleanPosting([job.description ?? '', job.requirements?.visa ?? ''].join('\n'));
  const gates: FitGate[] = [];
  const integrity = reviewPosting(job.description);
  if (integrity.suspicious) gates.push({ id: 'integrity', verdict: 'flag', note: integrity.verdict, quote: integrity.findings.instructions[0] ?? integrity.findings.hiddenText[0] ?? null });
  const eligibility = eligibilityGate(text);
  if (eligibility) gates.push(eligibility);
  const language = languageGate(text, profile.languages);
  if (language) gates.push(language);

  const lines = job.match?.lines ?? [];
  const strengths = lines.filter((line) => line.kind === 'must' && line.verdict === 'met').slice(0, 3).map(lineText);
  const gapLines = [
    ...lines.filter((line) => line.kind === 'must' && line.verdict === 'missing'),
    ...lines.filter((line) => line.kind === 'must' && line.verdict === 'partial'),
  ];
  const gaps = gapLines.slice(0, 3).map((line) => (line.verdict === 'partial' ? `${line.requirement.skill} (partly)` : line.requirement.skill));

  if (job.score === null || !job.match) {
    return { verdict: null, label: 'Not scored yet', advice: job.thin ? 'Only a title is known. Open the listing to judge it.' : 'Orbis will score it on the next run.', gates, strengths, gaps, questions: [] };
  }
  if (job.match.excluded) {
    return { verdict: 'poor', label: 'Ruled out', advice: `Skipped: ${job.match.excluded}.`, gates, strengths, gaps, questions: [] };
  }
  const band = verdictFor(job.score);
  const failed = gates.find((gate) => gate.verdict === 'fail');
  const advice = failed ? `Skip: ${failed.note.charAt(0).toLowerCase()}${failed.note.slice(1)}` : band.advice;
  const rough = job.match.confidence === 'low' ? ' The listing is thin, so this is a rough read.' : '';
  return { verdict: band.verdict, label: band.label, advice: advice + rough, gates, strengths, gaps, questions: questionsFor(job, gaps.length) };
}

export type SkillToBuild = { skill: string; jobs: number; titles: string[] };

/**
 * The must-have skills missing most often across the owner's best matches:
 * where learning one thing opens the most doors. Only jobs worth considering
 * (Moderate fit or better, not ruled out) count.
 */
export function skillsToBuild(jobs: ReadonlyArray<Pick<CareerJob, 'title' | 'company' | 'score' | 'match'>>, limit = 5): SkillToBuild[] {
  const tally = new Map<string, SkillToBuild>();
  const considered = jobs.filter((job) => job.match && !job.match.excluded && (job.score ?? 0) >= 45);
  for (const job of considered) {
    const missing = new Set(job.match!.lines.filter((line) => line.kind === 'must' && line.verdict !== 'met').map((line) => line.requirement.skill.trim()).filter(Boolean));
    for (const skill of missing) {
      const key = skill.toLowerCase();
      const entry = tally.get(key) ?? { skill, jobs: 0, titles: [] };
      entry.jobs += 1;
      if (entry.titles.length < 3) entry.titles.push(`${job.title} at ${job.company}`);
      tally.set(key, entry);
    }
  }
  return [...tally.values()].filter((entry) => entry.jobs >= 2).sort((a, b) => b.jobs - a.jobs || a.skill.localeCompare(b.skill)).slice(0, limit);
}
