/**
 * The truth check. Pure; it runs on every tailored draft before anything is
 * shown, and again on every text the owner edits.
 *
 * "Inventing anything" is the worst thing Career can do, so the rules are
 * deliberately blunt: a bullet must cite real facts from its own role, every
 * number in it must appear in those facts, and nothing may name a skill,
 * employer, degree or certification the profile doesn't have. What fails is
 * removed and listed, never quietly rewritten. Text the owner typed is theirs:
 * it stays, but anything that would have failed is highlighted.
 */
import type { CareerFact, CareerProfile, CitedText, Requirements, ScreeningAnswer, TailoredDraft, TruthRemoval } from './types.ts';
import { normaliseSkill, skillsMentioned } from './skills.ts';

// ─── Words ───────────────────────────────────────────────────────────────

function trimDots(word: string): string {
  let start = 0;
  let end = word.length;
  while (start < end && word[start] === '.') start += 1;
  while (end > start && word[end - 1] === '.') end -= 1;
  return word.slice(start, end);
}

/** Lowercase words with accents folded, keeping the symbols tech names use (c++, c#, node.js). */
export function wordsOf(text: string): string[] {
  const folded = text.normalize('NFKD').replaceAll(/\p{M}/gu, '').toLowerCase();
  const words: string[] = [];
  for (const raw of folded.split(/[^a-z0-9+#.]+/)) {
    const word = trimDots(raw);
    if (word) words.push(word);
  }
  return words;
}

/** Text prepared for whole-word phrase lookups with `hasPhrase`. */
export function phraseIndex(text: string): string {
  return ` ${wordsOf(text).join(' ')} `;
}

/** True when `phrase` appears in the indexed text as whole words ("java" is not found in "javascript"). */
export function hasPhrase(index: string, phrase: string): boolean {
  const words = wordsOf(phrase).join(' ');
  return words !== '' && index.includes(` ${words} `);
}

// ─── Numbers ─────────────────────────────────────────────────────────────

// A digit run with thousands separators (Western or Indian) and a decimal part. Linear: no nested repeats.
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const UNIT = /^ ?([a-z%×]+)/i;
const LETTER = /[a-z]/i;

const MULTIPLIERS = new Map<string, number>([
  ['k', 1e3], ['thousand', 1e3],
  ['m', 1e6], ['mn', 1e6], ['million', 1e6],
  ['b', 1e9], ['bn', 1e9], ['billion', 1e9],
  ['l', 1e5], ['lakh', 1e5], ['lakhs', 1e5], ['lac', 1e5], ['lacs', 1e5], ['lpa', 1e5],
  ['cr', 1e7], ['crore', 1e7], ['crores', 1e7],
]);
// Glued to a number these still make it a claim ("40%", "3x", "1st"); any other glued letters make an identifier ("3D", "2FA").
const CLAIM_SUFFIXES = new Set(['%', 'x', '×', 'st', 'nd', 'rd', 'th']);

export type Quantity = { raw: string; value: number };

/** One number token read at `index`, or null when it is part of a name like "p95", "EC2" or "3D". */
function readQuantity(text: string, match: string, index: number): Quantity | null {
  if (index > 0 && LETTER.test(text[index - 1])) return null;
  let digits = match;
  while (digits.endsWith(',')) digits = digits.slice(0, -1);
  const base = Number.parseFloat(digits.replaceAll(',', ''));
  if (!Number.isFinite(base)) return null;
  const tail = UNIT.exec(text.slice(index + match.length, index + match.length + 12));
  const unit = tail?.[1].toLowerCase() ?? '';
  const glued = Boolean(tail) && !tail?.[0].startsWith(' ');
  const multiplier = MULTIPLIERS.get(unit);
  if (multiplier) return { raw: `${digits}${tail?.[0] ?? ''}`, value: base * multiplier };
  if (glued && !CLAIM_SUFFIXES.has(unit)) return null;
  return { raw: glued ? `${digits}${unit}` : digits, value: base };
}

/** Every number, percentage, amount or multiplier in the text, as a comparable value: "₹1.2 Cr" and "1,20,00,000" are equal. */
export function quantities(text: string): Quantity[] {
  const found: Quantity[] = [];
  for (const match of text.matchAll(NUMBER)) {
    const quantity = readQuantity(text, match[0], match.index ?? 0);
    if (quantity) found.push(quantity);
  }
  return found;
}

const sameValue = (left: number, right: number) => Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));

// ─── Names ───────────────────────────────────────────────────────────────

// Words that introduce an organisation: "at X", "for X", "with X", "joined X".
const ORG_LEADS = new Set(['at', 'for', 'with', 'joined', 'join', 'joining']);
// Capitalised words that follow those leads without naming an organisation.
const NOT_ORGS = new Set([
  'i', 'the', 'a', 'an', 'my', 'our', 'their', 'his', 'her', 'its', 'this', 'that', 'these', 'those', 'each', 'every', 'all', 'both',
  'product', 'design', 'engineering', 'marketing', 'sales', 'finance', 'operations', 'support', 'legal', 'data', 'platform', 'growth',
  'leadership', 'customers', 'users', 'stakeholders', 'teams', 'team', 'clients', 'partners', 'hr', 'qa', 'ux', 'ui', 'seo',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'regards', 'thanks', 'best',
]);
const DEGREE_WORDS = new Set(['mba', 'phd', 'btech', 'mtech', 'bsc', 'msc', 'bca', 'mca', 'bachelor', 'bachelors', 'masters', 'doctorate', 'diploma', 'llb', 'mbbs']);

const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}+#]+$/gu;
const bare = (word: string) => word.replaceAll(EDGE_PUNCTUATION, '');
const capitalised = (word: string) => /^\p{Lu}/u.test(word);
const endsClause = (word: string) => /[,.;:!?)]$/.test(word);

/** The capitalised words starting at `start` ("Stripe", "Goldman Sachs"), up to four, stopping at punctuation. */
function capitalisedRun(words: string[], start: number): string {
  const run: string[] = [];
  for (let index = start; index < words.length && run.length < 4; index += 1) {
    const word = bare(words[index]);
    if (!word || !capitalised(word)) break;
    run.push(word);
    if (endsClause(words[index])) break;
  }
  return run.join(' ');
}

/** The organisations the text names after "at", "for", "with" or "joined". */
export function namedOrganisations(text: string): string[] {
  const words = text.split(/\s+/);
  const names: string[] = [];
  for (let index = 0; index < words.length - 1; index += 1) {
    if (!ORG_LEADS.has(bare(words[index]).toLowerCase()) || endsClause(words[index])) continue;
    const name = capitalisedRun(words, index + 1);
    if (name && !NOT_ORGS.has(name.split(' ')[0].toLowerCase())) names.push(name);
  }
  return names;
}

// ─── The rules ───────────────────────────────────────────────────────────

/** What a text is checked against, built once per draft. */
type Context = {
  facts: Map<string, CareerFact>;
  /** Every true text the profile holds, for text that cites nothing. */
  everything: string[];
  /** Organisations, places, people and things the profile names, one index each. */
  known: string[];
  skillNames: Set<string>;
  /** Skills the job asks for that the profile lacks: the ones a model is tempted to invent. */
  lacking: string[];
  certificates: string[];
  degrees: Set<string>;
  owner: string[];
};

function knownNames(profile: CareerProfile, job: TailorJob | undefined): string[] {
  return [
    profile.contact.name, profile.contact.location ?? '', profile.headline ?? '',
    ...profile.roles.flatMap((role) => [role.employer, role.title, role.location ?? '']),
    ...profile.education.flatMap((item) => [item.institution, item.degree, item.field ?? '']),
    ...profile.certifications.flatMap((cert) => [cert.name, cert.issuer ?? '']),
    ...profile.projects.map((project) => project.name),
    ...profile.skills.flatMap((skill) => [skill.label, skill.name]),
    ...profile.languages,
    job?.company ?? '', job?.title ?? '',
  ].filter(Boolean);
}

function lackingSkills(profile: CareerProfile, requirements: Requirements | null | undefined, skillNames: Set<string>): string[] {
  if (!requirements) return [];
  const asked = [...requirements.mustHave, ...requirements.niceToHave].map((item) => item.skill);
  return asked.filter((skill) => !skillNames.has(normaliseSkill(skill)) && !profile.facts.some((fact) => hasPhrase(phraseIndex(fact.text), skill)));
}

function buildContext(input: TruthInput): Context {
  const { profile } = input;
  const skillNames = new Set(profile.skills.map((skill) => normaliseSkill(skill.name)));
  const degreeText = profile.education.map((item) => `${item.degree} ${item.field ?? ''}`).join(' ');
  return {
    facts: new Map(profile.facts.map((fact) => [fact.id, fact])),
    everything: [
      ...profile.facts.map((fact) => fact.text),
      profile.summary ?? '',
      profile.headline ?? '',
      ...profile.skills.map((skill) => (skill.years === null ? '' : `${skill.years} years`)),
      ...profile.education.map((item) => `${item.end ?? ''} ${item.grade ?? ''}`),
      ...profile.certifications.map((cert) => `${cert.name} ${cert.year ?? ''}`),
    ],
    known: knownNames(profile, input.job).map(phraseIndex),
    skillNames,
    lacking: lackingSkills(profile, input.requirements, skillNames),
    certificates: profile.certifications.map((cert) => phraseIndex(cert.name)),
    degrees: new Set(wordsOf(degreeText).map((word) => word.replaceAll('.', ''))),
    owner: (input.ownerEdits ?? []).map((text) => text.replaceAll(/\s+/g, ' ').trim()).filter(Boolean),
  };
}

function unbackedNumber(text: string, backing: string[]): string | null {
  const pool = backing.flatMap(quantities).map((quantity) => quantity.value);
  const missing = quantities(text).find((quantity) => !pool.some((value) => sameValue(value, quantity.value)));
  return missing ? `"${missing.raw}" isn't in the facts it rests on` : null;
}

/** A skill the text names that neither the profile nor the facts behind it have. */
function unknownSkill(text: string, backing: string[], context: Context): string | null {
  const backed = new Set(backing.flatMap(skillsMentioned));
  const named = skillsMentioned(text).find((skill) => !context.skillNames.has(skill) && !backed.has(skill));
  if (named) return `${named} isn't in your profile`;
  // The job's own wording for what the profile lacks, in case the vocabulary doesn't know it.
  const index = phraseIndex(text);
  const backedIndex = phraseIndex(backing.join(' | '));
  const asked = context.lacking.find((term) => hasPhrase(index, term) && !hasPhrase(backedIndex, term));
  return asked ? `${asked} isn't in your profile` : null;
}

const inAny = (indexes: string[], phrase: string) => indexes.some((index) => hasPhrase(index, phrase));

function isKnownName(name: string, context: Context): boolean {
  if (context.skillNames.has(normaliseSkill(name))) return true;
  // "Acme Corp" still names Acme Payments, and "React Native" starts with a known skill: a known start counts.
  const words = wordsOf(name);
  return words.some((_, end) => inAny(context.known, words.slice(0, words.length - end).join(' ')));
}

function unknownOrganisation(text: string, context: Context): string | null {
  const name = namedOrganisations(text).find((candidate) => !isKnownName(candidate, context));
  return name ? `"${name}" isn't an employer, school or project in your profile` : null;
}

function unknownCredential(text: string, context: Context): string | null {
  const words = wordsOf(text).map((word) => word.replaceAll('.', ''));
  if (words.some((word) => DEGREE_WORDS.has(word) && !context.degrees.has(word))) return 'it names a degree that isn\'t in your profile';
  const parts = text.split(/\s+/);
  const at = parts.findIndex((word) => bare(word).toLowerCase() === 'certified');
  if (at < 0) return null;
  // The capitalised words around "Certified" name the certificate: "AWS Certified Developer", "certified Scrum Master".
  let start = at;
  while (start > 0 && capitalised(bare(parts[start - 1])) && !endsClause(parts[start - 1])) start -= 1;
  const after = capitalisedRun(parts, at + 1);
  if (start === at && !after) return null;
  const name = [...parts.slice(start, at + 1).map(bare), after].filter(Boolean).join(' ');
  if (inAny(context.certificates, name)) return null;
  return `"${name}" isn't a certification in your profile`;
}

/** Why the text can't be backed up, or null when it can. `backing` is the true text it may draw on. */
function problem(text: string, backing: string[], context: Context): string | null {
  return unbackedNumber(text, backing)
    ?? unknownSkill(text, backing, context)
    ?? unknownOrganisation(text, context)
    ?? unknownCredential(text, context);
}

// ─── Applying them ───────────────────────────────────────────────────────

/** The target job, so the cover note may name the company and the role. */
export type TailorJob = { company: string; title: string };

export type TruthInput = {
  draft: TailoredDraft;
  coverNote: CitedText;
  answers: ScreeningAnswer[];
  outreach: string;
  profile: CareerProfile;
  /** Texts the owner typed or edited: kept even when they'd fail, but highlighted. */
  ownerEdits?: string[];
  /** Skills the job asks for are the ones a model is tempted to claim; naming them sharpens the check. */
  requirements?: Requirements | null;
  job?: TailorJob;
};

export type TruthResult = {
  draft: TailoredDraft;
  coverNote: CitedText;
  answers: ScreeningAnswer[];
  outreach: string;
  removed: TruthRemoval[];
  /** Owner-typed text that wouldn't have passed: kept, shown highlighted. */
  highlights: TruthRemoval[];
  /** Removed bullets over all bullets, 0–1. Above a third, the draft is regenerated once. */
  failedShare: number;
};

/** Collects removals and highlights while the parts are checked. */
class Verdicts {
  readonly removed: TruthRemoval[] = [];
  readonly highlights: TruthRemoval[] = [];

  constructor(private readonly context: Context) {}

  /** True when the text stays. Owner text always stays, highlighted if it would have failed. */
  keep(where: string, text: string, reason: string | null): boolean {
    if (!reason) return true;
    const flat = text.replaceAll(/\s+/g, ' ').trim();
    if (this.context.owner.some((edit) => edit.includes(flat))) {
      this.highlights.push({ where, text, reason });
      return true;
    }
    this.removed.push({ where, text, reason });
    return false;
  }
}

/** Why a bullet's citations don't hold, or null when they do. `allowed` says which facts this place may cite. */
function citationProblem(bullet: CitedText, context: Context, allowed: (fact: CareerFact) => boolean): string | null {
  if (!bullet.factIds.length) return 'it cites no fact';
  for (const id of bullet.factIds) {
    const fact = context.facts.get(id);
    if (!fact) return `it cites ${id}, which doesn't exist`;
    if (!allowed(fact)) return `it cites ${id}, which belongs to another role`;
  }
  return null;
}

function checkBullets(bullets: CitedText[], where: string, allowed: (fact: CareerFact) => boolean, context: Context, verdicts: Verdicts): CitedText[] {
  return bullets.filter((bullet) => {
    const backing = bullet.factIds.map((id) => context.facts.get(id)?.text ?? '');
    const reason = citationProblem(bullet, context, allowed) ?? problem(bullet.text, backing, context);
    return verdicts.keep(where, bullet.text, reason);
  });
}

/**
 * Prose checked sentence by sentence, so one bad claim doesn't cost the whole
 * paragraph. The kept sentences keep the spacing that came before them, so a
 * cover note's paragraph breaks survive the check (and an owner's edit comes
 * back as they typed it).
 */
function checkProse(text: string, where: string, backing: string[], context: Context, verdicts: Verdicts): string {
  // Odd entries are the whitespace between sentences.
  const parts = text.split(/(?<=[.!?])(\s+)/);
  let kept = '';
  // A paragraph break before a dropped sentence still separates what's left around it.
  let carried = '';
  for (let index = 0; index < parts.length; index += 2) {
    const sentence = parts[index];
    const gap = carried.includes('\n') ? carried : parts[index - 1] ?? '';
    if (!sentence.trim() || !verdicts.keep(where, sentence, problem(sentence, backing, context))) {
      carried = gap;
      continue;
    }
    kept += kept ? `${gap || ' '}${sentence}` : sentence;
    carried = '';
  }
  return kept;
}

/** Cited prose (summary, cover note): unknown ids are dropped, then each sentence is checked against what's left. */
function checkCited(cited: CitedText, where: string, context: Context, verdicts: Verdicts): CitedText {
  const factIds = cited.factIds.filter((id) => context.facts.has(id));
  const backing = factIds.map((id) => context.facts.get(id)?.text ?? '');
  return { text: checkProse(cited.text, where, backing, context, verdicts), factIds };
}

function checkSkills(skills: string[], context: Context, verdicts: Verdicts): string[] {
  const kept: string[] = [];
  for (const skill of skills) {
    const name = normaliseSkill(skill);
    const known = context.skillNames.has(name);
    if (verdicts.keep('skills', skill, known ? null : `${skill} isn't in your profile`) && !kept.includes(known ? name : skill)) {
      kept.push(known ? name : skill);
    }
  }
  return kept;
}

function checkDraft(draft: TailoredDraft, input: TruthInput, context: Context, verdicts: Verdicts): TailoredDraft {
  const projects = new Map(input.profile.projects.map((project) => [project.id, project]));
  const roleTitle = new Map(input.profile.roles.map((role) => [role.id, role.title]));
  const headlineReason = problem(draft.headline, context.everything, context);
  return {
    headline: verdicts.keep('headline', draft.headline, headlineReason) ? draft.headline : '',
    summary: checkCited(draft.summary, 'summary', context, verdicts),
    skills: checkSkills(draft.skills, context, verdicts),
    roles: draft.roles.map((role) => ({
      roleId: role.roleId,
      // A fact from another job may not be moved under this one; facts with no role may go anywhere.
      bullets: checkBullets(role.bullets, roleTitle.get(role.roleId) ?? role.roleId, (fact) => fact.roleId === null || fact.roleId === role.roleId, context, verdicts),
    })),
    projects: draft.projects.map((project) => {
      const own = new Set(projects.get(project.projectId)?.factIds ?? []);
      const where = projects.get(project.projectId)?.name ?? project.projectId;
      return { projectId: project.projectId, bullets: checkBullets(project.bullets, where, (fact) => own.has(fact.id) || fact.roleId === null, context, verdicts) };
    }),
  };
}

const bulletCount = (draft: TailoredDraft) =>
  [...draft.roles, ...draft.projects].reduce((sum, item) => sum + item.bullets.length, 0);

/** The draft, cover note, answers and outreach with everything that can't be backed up removed and listed. */
export function checkTailored(input: TruthInput): TruthResult {
  const context = buildContext(input);
  const verdicts = new Verdicts(context);
  const draft = checkDraft(input.draft, input, context, verdicts);
  const coverNote = checkCited(input.coverNote, 'cover note', context, verdicts);
  const answers = input.answers.filter((answer) => verdicts.keep(`answer: ${answer.question}`, answer.answer, problem(answer.answer, context.everything, context)));
  const outreach = checkProse(input.outreach, 'outreach', context.everything, context, verdicts);
  const before = bulletCount(input.draft);
  return {
    draft,
    coverNote,
    answers,
    outreach,
    removed: verdicts.removed,
    highlights: verdicts.highlights,
    failedShare: before ? (before - bulletCount(draft)) / before : 0,
  };
}
