/**
 * Career: the deterministic match of profile against a job (design: Pipeline
 * → Match). Client-safe and pure, so the same numbers come out on the server,
 * on screen and in the skill-gap radar's counterfactual rescoring.
 *
 *   score = 60 × mustCoverage + 20 × niceCoverage + 10 × experienceFit + 10 × roleFit
 *
 * - Coverage: met counts 1, partial 0.5, missing 0, averaged over the list.
 * - An empty must-have list moves its 60 to nice-to-haves, or to role fit when
 *   that list is empty too. An empty nice-to-have list moves its 20 to the
 *   must-haves, or to role fit when both are empty.
 * - A profile skill counts only with evidence: a fact that cites or names it,
 *   or a role whose title names it. The skill list alone proves nothing.
 * - Thin listings and jobs without extracted requirements are scored on role
 *   fit alone, with confidence 'low', and top out at LOW_CONFIDENCE_CEILING: a
 *   title can say the job is your role, never that you'd get it.
 * - Hard filters from the spec set `excluded` whatever the score.
 */
import type { CareerProfile, CareerRole, CareerSpec, Match, MatchLine, NormalizedJob, Requirement, Requirements, SalaryPeriod, Seniority } from './types.ts';
import { normaliseSkill, relatedSkills, skillsMentioned } from './skills.ts';
import { placeWords } from './normalise.ts';
import { deriveSkillYears, factSkills, newId, totalYears } from './profile.ts';
import { dealBreakerIn, titleFitsRole } from './prefilter.ts';

export const WEIGHTS = { must: 60, nice: 20, experience: 10, role: 10 } as const;

/** Above the default threshold (50), so a thin listing in your role still shows in For you, flagged; below a well-evidenced full match. */
export const LOW_CONFIDENCE_CEILING = 70;

/** Hours in a working year (40 × 52), for comparing an hourly rate with a yearly floor. */
const HOURS_PER_YEAR = 2080;

export type MatchInput = {
  profile: CareerProfile;
  spec: CareerSpec;
  job: NormalizedJob;
  requirements: Requirements | null;
  /** 'YYYY-MM-DD'; current roles run to this month. */
  today: string;
  /** The owner's extra title synonym groups (settings.synonyms). */
  synonyms?: readonly string[][];
};

// ─── Evidence ───────────────────────────────────────────────────────────

type Evidence = { factIds: string[]; roleIds: string[] };

/** Every evidenced skill with the facts and roles behind it. */
function evidenceBySkill(profile: CareerProfile): Map<string, Evidence> {
  const map = new Map<string, Evidence>();
  const entry = (skill: string) => {
    const found = map.get(skill) ?? { factIds: [], roleIds: [] };
    map.set(skill, found);
    return found;
  };
  for (const fact of profile.facts) {
    for (const skill of factSkills(fact)) {
      const found = entry(skill);
      found.factIds.push(fact.id);
      if (fact.roleId && !found.roleIds.includes(fact.roleId)) found.roleIds.push(fact.roleId);
    }
  }
  for (const role of profile.roles) {
    for (const skill of skillsMentioned(role.title)) {
      const found = entry(skill);
      if (!found.roleIds.includes(role.id)) found.roleIds.push(role.id);
    }
  }
  return map;
}

type Context = {
  evidence: Map<string, Evidence>;
  derived: Record<string, number>;
  ownerYears: Map<string, number>;
  roles: Map<string, CareerRole>;
};

function contextOf(profile: CareerProfile, today: string): Context {
  const ownerYears = new Map<string, number>();
  for (const skill of profile.skills) if (skill.years !== null) ownerYears.set(normaliseSkill(skill.name), skill.years);
  return {
    evidence: evidenceBySkill(profile),
    derived: deriveSkillYears(profile, today),
    ownerYears,
    roles: new Map(profile.roles.map((role) => [role.id, role])),
  };
}

/** Years with an evidenced skill: the larger of the role-derived figure and the owner's own. Null when neither is known. */
function yearsWith(context: Context, skill: string): number | null {
  const derived = context.derived[skill];
  const owner = context.ownerYears.get(skill);
  if (derived === undefined && owner === undefined) return null;
  return Math.max(derived ?? 0, owner ?? 0);
}

// ─── Lines ──────────────────────────────────────────────────────────────

function formatYears(years: number) {
  const shown = Number.isInteger(years) ? String(years) : years.toFixed(1);
  return `${shown} ${years === 1 ? 'year' : 'years'}`;
}

/** "at Acme and Bolt", or "in 2 facts" when no role backs it. */
function whereShown(context: Context, evidence: Evidence) {
  const employers: string[] = [];
  for (const id of evidence.roleIds) {
    const employer = context.roles.get(id)?.employer;
    if (employer && !employers.includes(employer)) employers.push(employer);
  }
  if (employers.length === 1) return `at ${employers[0]}`;
  if (employers.length === 2) return `at ${employers[0]} and ${employers[1]}`;
  if (employers.length > 2) return `at ${employers[0]}, ${employers[1]} and ${employers.length - 2} more`;
  const count = evidence.factIds.length;
  return `in ${count} ${count === 1 ? 'fact' : 'facts'}`;
}

function ids(evidence: Evidence) {
  return [...evidence.factIds, ...evidence.roleIds];
}

function ownSkillLine(context: Context, requirement: Requirement, kind: MatchLine['kind'], evidence: Evidence): MatchLine {
  const where = whereShown(context, evidence);
  const years = yearsWith(context, requirement.skill);
  const base = { requirement, kind, evidence: ids(evidence) };
  if (requirement.years === null) {
    const note = years === null ? `Shown ${where}` : `${formatYears(years)}, ${where}`;
    return { ...base, verdict: 'met', note };
  }
  if (years !== null && years >= requirement.years) return { ...base, verdict: 'met', note: `${formatYears(years)}, ${where}` };
  const note = years === null
    ? `Shown ${where}, but no dated role backs ${requirement.years} years`
    : `${formatYears(years)} of ${requirement.years} asked, ${where}`;
  return { ...base, verdict: 'partial', note };
}

function judge(context: Context, raw: Requirement, kind: MatchLine['kind']): MatchLine {
  const requirement = { ...raw, skill: normaliseSkill(raw.skill) };
  const own = context.evidence.get(requirement.skill);
  if (own) return ownSkillLine(context, requirement, kind, own);
  for (const related of relatedSkills(requirement.skill)) {
    const evidence = context.evidence.get(related);
    if (evidence) {
      return { requirement, kind, verdict: 'partial', evidence: ids(evidence), note: `Related: ${related}, ${whereShown(context, evidence)}` };
    }
  }
  return { requirement, kind, verdict: 'missing', evidence: [], note: 'Not in your profile' };
}

const CREDIT = { met: 1, partial: 0.5, missing: 0 } as const;

function coverage(lines: MatchLine[]) {
  if (!lines.length) return 0;
  return lines.reduce((sum, line) => sum + CREDIT[line.verdict], 0) / lines.length;
}

// ─── Experience and role ────────────────────────────────────────────────

// Two ladders share a rank: a lead and a manager are both a step above senior.
const SENIORITY_RANK: Record<Seniority, number> = {
  intern: 0, junior: 1, mid: 2, senior: 3, lead: 4, manager: 4, principal: 5, director: 5, executive: 6,
};

/** 1 when the job's level is one the owner wants, 0.5 a step away, 0 further; 1 when either side is silent. */
function seniorityFit(asked: Seniority | null, wanted: Seniority[]) {
  if (!asked || !wanted.length) return 1;
  const distance = Math.min(...wanted.map((level) => Math.abs(SENIORITY_RANK[level] - SENIORITY_RANK[asked])));
  if (distance === 0) return 1;
  return distance === 1 ? 0.5 : 0;
}

/** The mean of years fit (total experience against minYears, capped at 1) and seniority fit. */
function experienceFit(profile: CareerProfile, spec: CareerSpec, requirements: Requirements, today: string) {
  const years = totalYears(profile, today);
  const yearsFit = requirements.minYears ? Math.min(1, years / requirements.minYears) : 1;
  return (yearsFit + seniorityFit(requirements.seniority, spec.seniority)) / 2;
}

/**
 * 1 when the title is one of the spec's target roles; 0.5 when it is only a
 * role the owner has held; 0 otherwise. With no target roles, a held role
 * counts 1, and an empty history is neutral 0.5.
 */
export function roleFit(title: string, spec: CareerSpec, profile: CareerProfile, synonyms: readonly string[][] = []): number {
  const held = profile.roles.some((role) => titleFitsRole(title, role.title, synonyms));
  if (spec.roles.length) {
    if (spec.roles.some((role) => titleFitsRole(title, role, synonyms))) return 1;
    return held ? 0.5 : 0;
  }
  if (held) return 1;
  return profile.roles.length ? 0 : 0.5;
}

/** Where each component's points go when its list is empty (see the header). */
function weightsFor(mustCount: number, niceCount: number) {
  const weights: { must: number; nice: number; experience: number; role: number } = { ...WEIGHTS };
  if (!mustCount) {
    if (niceCount) weights.nice += weights.must;
    else weights.role += weights.must;
    weights.must = 0;
  }
  if (!niceCount) {
    if (mustCount) weights.must += weights.nice;
    else weights.role += weights.nice;
    weights.nice = 0;
  }
  return weights;
}

const oneDecimal = (value: number) => Math.round(value * 10) / 10;

// ─── Hard filters ───────────────────────────────────────────────────────

/** An amount over a year: hour × 2080, month × 12. */
export function annualise(amount: number, period: SalaryPeriod): number {
  if (period === 'hour') return amount * HOURS_PER_YEAR;
  if (period === 'month') return amount * 12;
  return amount;
}

function trimNumber(value: number) {
  return String(Math.round(value * 10) / 10);
}

/** Short money for a note: "₹18L", "₹1.2Cr", "USD 120k". */
export function formatMoney(amount: number, currency: string): string {
  if (currency === 'INR') {
    if (amount >= 1e7) return `₹${trimNumber(amount / 1e7)}Cr`;
    if (amount >= 1e5) return `₹${trimNumber(amount / 1e5)}L`;
    return `₹${Math.round(amount)}`;
  }
  if (amount >= 1e6) return `${currency} ${trimNumber(amount / 1e6)}M`;
  if (amount >= 1e3) return `${currency} ${trimNumber(amount / 1e3)}k`;
  return `${currency} ${Math.round(amount)}`;
}

function salaryExclusion(spec: CareerSpec, job: NormalizedJob, requirements: Requirements | null): string | null {
  const floor = spec.salaryFloor;
  const pay = requirements?.salary ?? job.salary;
  if (!floor || pay?.max === null || pay?.max === undefined) return null;
  // Different currencies can't be compared without a rate we don't have; skip rather than guess.
  if (pay.currency.toUpperCase() !== floor.currency.toUpperCase()) return null;
  const max = annualise(pay.max, pay.period);
  const wanted = annualise(floor.amount, floor.period);
  if (max >= wanted) return null;
  return `Pays up to ${formatMoney(max, floor.currency)} a year; your floor is ${formatMoney(wanted, floor.currency)}`;
}

function dealBreakerExclusion(spec: CareerSpec, job: NormalizedJob, requirements: Requirements | null): string | null {
  const inTitle = dealBreakerIn(job.title, spec.dealBreakers);
  if (inTitle) return `Deal-breaker: ${inTitle}`;
  const required = new Set(requirements?.mustHave.map((item) => normaliseSkill(item.skill)) ?? []);
  const asked = spec.dealBreakers.find((breaker) => required.has(normaliseSkill(breaker)));
  return asked ? `Deal-breaker: requires ${asked}` : null;
}

function jobMode(job: NormalizedJob, requirements: Requirements | null) {
  return requirements?.locationPolicy.mode ?? (job.remote ? 'remote' : null);
}

function modeExclusion(spec: CareerSpec, job: NormalizedJob, requirements: Requirements | null): string | null {
  const mode = jobMode(job, requirements);
  if (!mode || !spec.workModes.length || spec.workModes.includes(mode)) return null;
  return `${mode[0].toUpperCase()}${mode.slice(1)} role; you want ${spec.workModes.join(' or ')}`;
}

const ANYWHERE = new Set(['anywhere', 'worldwide', 'global', 'remote', 'any']);

// Regions a remote job may name, with the countries inside them (after PLACE_ALIASES).
const ASIA_PACIFIC = ['india', 'singapore', 'japan', 'australia', 'philippines', 'indonesia', 'malaysia', 'vietnam', 'new zealand'];
const EUROPE = ['uk', 'germany', 'france', 'netherlands', 'spain', 'ireland', 'poland', 'portugal', 'sweden', 'italy'];
const REGION_MEMBERS: Record<string, string[]> = {
  apac: ASIA_PACIFIC,
  'asia pacific': ASIA_PACIFIC,
  asia: ['india', 'singapore', 'japan', 'philippines', 'indonesia', 'malaysia', 'vietnam', 'uae'],
  'south asia': ['india', 'sri lanka', 'bangladesh', 'nepal', 'pakistan'],
  emea: [...EUROPE, 'uae', 'israel', 'south africa', 'nigeria', 'kenya'],
  europe: EUROPE,
  eu: EUROPE.filter((country) => country !== 'uk'),
  americas: ['usa', 'canada', 'brazil', 'mexico', 'argentina'],
  'north america': ['usa', 'canada', 'mexico'],
  latam: ['brazil', 'mexico', 'argentina', 'colombia', 'chile'],
};

// Longest first, so "united states of america" is replaced before "united states".
const PLACE_ALIASES: Array<[string, string]> = [
  ['united states of america', 'usa'], ['united states', 'usa'], ['us', 'usa'], ['united kingdom', 'uk'], ['great britain', 'uk'],
  ['england', 'uk'], ['new delhi', 'delhi'], ['bangalore', 'bengaluru'], ['gurgaon', 'gurugram'], ['bombay', 'mumbai'],
];

// The owner is in India: an Indian city implies the country, so "Pune" is covered by "India only".
const INDIAN_CITIES = new Set([
  'bengaluru', 'mumbai', 'pune', 'hyderabad', 'chennai', 'delhi', 'gurugram', 'noida', 'kolkata', 'ahmedabad', 'kochi',
  'jaipur', 'indore', 'chandigarh', 'coimbatore', 'thiruvananthapuram', 'mysuru', 'nagpur', 'lucknow', 'bhubaneswar',
]);

/** A place as alias-resolved words, without "remote"/"anywhere"; `anywhere` when that was all it said. */
function placeKey(text: string) {
  let joined = ` ${placeWords(text).join(' ')} `;
  for (const [alias, canonical] of PLACE_ALIASES) joined = joined.replaceAll(` ${alias} `, ` ${canonical} `);
  const all = joined.trim().split(' ').filter(Boolean);
  const words = all.filter((word) => !ANYWHERE.has(word));
  const inIndia = words.includes('india') || words.some((word) => INDIAN_CITIES.has(word));
  return { words, anywhere: all.length > 0 && words.length === 0, country: inIndia ? 'india' : null };
}

/**
 * True when a place a job names covers a place the owner accepts: every word
 * of the wanted place is in the job's ("Bengaluru, Karnataka, India" covers
 * "India"), the job names the wanted place's country ("India" covers "Pune"),
 * or a region that contains it ("APAC" covers "India").
 */
export function placeCovers(jobPlace: string, wanted: string): boolean {
  const job = placeKey(jobPlace);
  const want = placeKey(wanted);
  if (job.anywhere) return true;
  if (!job.words.length || !want.words.length) return false;
  const jobWords = new Set(job.words);
  if (job.country) jobWords.add(job.country);
  if (want.words.every((word) => jobWords.has(word))) return true;
  const jobName = job.words.join(' ');
  const wantName = want.words.join(' ');
  if (want.country && jobName === want.country) return true;
  const members = REGION_MEMBERS[jobName] ?? [];
  return members.some((member) => member === want.country || member === wantName);
}

function placeExclusion(spec: CareerSpec, job: NormalizedJob, requirements: Requirements | null): string | null {
  const wanted = spec.locations.filter((place) => !ANYWHERE.has(place.trim().toLowerCase()));
  if (!wanted.length) return null;
  const mode = jobMode(job, requirements);
  // Remote: the places it is open to. On site or hybrid: where the office is. Unknown mode: no filter.
  let places: string[] = [];
  if (mode === 'remote') places = requirements?.locationPolicy.where ?? [];
  else if (mode) places = job.location ? [job.location] : (requirements?.locationPolicy.where ?? []);
  if (!places.length) return null;
  if (places.some((place) => wanted.some((want) => placeCovers(place, want)))) return null;
  const where = mode === 'remote' ? `Remote, ${places.join(' / ')} only` : `In ${places.join(' / ')}`;
  return `${where}; you want ${wanted.join(', ')}`;
}

/** The first hard filter the job fails, as a reason, or null. */
export function exclusionFor(spec: CareerSpec, job: NormalizedJob, requirements: Requirements | null): string | null {
  return dealBreakerExclusion(spec, job, requirements)
    ?? modeExclusion(spec, job, requirements)
    ?? placeExclusion(spec, job, requirements)
    ?? salaryExclusion(spec, job, requirements);
}

// ─── Score ──────────────────────────────────────────────────────────────

export function scoreMatch(input: MatchInput): Match {
  const { profile, spec, job, requirements, today } = input;
  const context = contextOf(profile, today);
  const lines = requirements
    ? [...requirements.mustHave.map((item) => judge(context, item, 'must')), ...requirements.niceToHave.map((item) => judge(context, item, 'nice'))]
    : [];
  const role = roleFit(job.title, spec, profile, input.synonyms);
  const excluded = exclusionFor(spec, job, requirements);

  // Too little to judge skills on: role fit only, capped.
  if (!requirements || job.thin || !job.description) {
    const points = oneDecimal(role * LOW_CONFIDENCE_CEILING);
    return { score: Math.round(role * LOW_CONFIDENCE_CEILING), confidence: 'low', parts: { must: 0, nice: 0, experience: 0, role: points }, lines, excluded };
  }

  const must = lines.filter((line) => line.kind === 'must');
  const nice = lines.filter((line) => line.kind === 'nice');
  const weights = weightsFor(must.length, nice.length);
  const raw = {
    must: weights.must * coverage(must),
    nice: weights.nice * coverage(nice),
    experience: weights.experience * experienceFit(profile, spec, requirements, today),
    role: weights.role * role,
  };
  const score = Math.round(raw.must + raw.nice + raw.experience + raw.role);
  return {
    score,
    confidence: 'high',
    parts: { must: oneDecimal(raw.must), nice: oneDecimal(raw.nice), experience: oneDecimal(raw.experience), role: oneDecimal(raw.role) },
    lines,
    excluded,
  };
}

/**
 * The profile with one more evidenced skill, for the skill-gap radar's "what
 * if you had X" rescoring. Never saved: the synthetic fact says what it is.
 * `years` sets the skill's years so year-bound requirements can be met too.
 */
export function withSkill(profile: CareerProfile, skill: string, years: number | null = null): CareerProfile {
  const name = normaliseSkill(skill);
  const fact = { id: newId('f'), text: `Counterfactual: ${name}`, roleId: null, skills: [name], confirmed: false };
  const known = profile.skills.some((entry) => entry.name === name);
  const skills = known
    ? profile.skills.map((entry) => (entry.name === name ? { ...entry, years: years ?? entry.years } : entry))
    : [...profile.skills, { name, label: skill, years }];
  return { ...profile, skills, facts: [...profile.facts, fact] };
}
