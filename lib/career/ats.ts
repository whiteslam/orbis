/**
 * The ATS check. Pure: it takes the text pdfjs read back from our rendered
 * resume and confirms an applicant-tracking system would find what matters —
 * the contact line, the standard headings in order, every role title, a
 * sensible length — and how many of the job's terms it would match.
 */
import type { AtsReport, CareerProfile, Requirements } from './types.ts';
import { RESUME_HEADINGS, orderedRoles, type ResumeHeading } from './render/layout.ts';
import { toWinAnsi } from './render/winansi.ts';
import { hasPhrase, phraseIndex } from './truth.ts';
import { normaliseSkill } from './skills.ts';

const MAX_PAGES = 2;
/** Below this share of the job's terms the keyword check is flagged; it never fails the report on its own. */
const KEYWORD_TARGET = 0.6;

type Check = AtsReport['checks'][number];

/** Text compared the way both renderers write it: WinAnsi, no accents, one space, lowercase. */
const fold = (text: string) => toWinAnsi(text).normalize('NFKD').replaceAll(/\p{M}/gu, '').replaceAll(/\s+/g, ' ').toLowerCase().trim();

/** Positions of `needles` found one after another in `haystack`, or the first one missing. */
function inOrder(haystack: string, needles: string[]): { ok: boolean; missing: string | null; outOfOrder: string | null } {
  let from = 0;
  for (const needle of needles) {
    const at = haystack.indexOf(fold(needle), from);
    if (at >= 0) {
      from = at + fold(needle).length;
      continue;
    }
    const missing = !haystack.includes(fold(needle));
    return { ok: false, missing: missing ? needle : null, outOfOrder: missing ? null : needle };
  }
  return { ok: true, missing: null, outOfOrder: null };
}

function contactChecks(text: string, profile: CareerProfile): Check[] {
  const email = profile.contact.email.trim();
  const name = profile.contact.name.trim();
  return [
    { id: 'email', ok: Boolean(email) && text.includes(fold(email)), note: email ? `Email ${email} must be readable as text` : 'Add an email to your profile' },
    { id: 'name', ok: Boolean(name) && text.includes(fold(name)), note: 'Your name should be the first line' },
  ];
}

/** Headings are matched as whole lines, so "Experience" in a sentence doesn't count. */
function headingCheck(lines: string[], profile: CareerProfile): Check {
  const required: ResumeHeading[] = ['Experience'];
  if (profile.skills.length) required.push('Skills');
  if (profile.education.length) required.push('Education');
  const found = lines.flatMap((line) => RESUME_HEADINGS.filter((heading) => fold(heading) === line));
  const missing = required.filter((heading) => !found.includes(heading));
  const order = found.map((heading) => RESUME_HEADINGS.indexOf(heading));
  const ordered = order.every((position, index) => index === 0 || position > order[index - 1]);
  if (missing.length) return { id: 'headings', ok: false, note: `Missing section heading: ${missing.join(', ')}` };
  if (!ordered) return { id: 'headings', ok: false, note: `Headings out of order: ${found.join(', ')}` };
  return { id: 'headings', ok: true, note: `Headings found in order: ${found.join(', ')}` };
}

function roleCheck(text: string, profile: CareerProfile): Check {
  const titles = orderedRoles(profile).map((role) => role.title).filter((title) => title.trim());
  const result = inOrder(text, titles);
  if (result.missing) return { id: 'roles', ok: false, note: `Role title not readable: ${result.missing}` };
  if (result.outOfOrder) return { id: 'roles', ok: false, note: `Role title out of order: ${result.outOfOrder}` };
  return { id: 'roles', ok: true, note: `All ${titles.length} role titles found, newest first` };
}

function pageCheck(pages: number): Check {
  if (pages > MAX_PAGES) return { id: 'pages', ok: false, note: `${pages} pages; keep it to ${MAX_PAGES}` };
  return { id: 'pages', ok: true, note: pages === 1 ? '1 page' : `${pages} pages` };
}

/** The job's terms, one per normalised skill, keeping the job's own wording as the label. */
function jobTerms(requirements: Requirements): Array<{ label: string; name: string }> {
  const terms = new Map<string, string>();
  for (const item of [...requirements.mustHave, ...requirements.niceToHave]) {
    const name = normaliseSkill(item.skill);
    if (name && !terms.has(name)) terms.set(name, item.skill.trim());
  }
  return [...terms].map(([name, label]) => ({ name, label }));
}

/** A term is found under the job's wording, its normalised name, or any profile label that normalises to it. */
function keywordCoverage(text: string, profile: CareerProfile, requirements: Requirements) {
  const index = phraseIndex(text);
  const terms = jobTerms(requirements);
  const missing: string[] = [];
  for (const term of terms) {
    const labels = profile.skills.filter((skill) => normaliseSkill(skill.name) === term.name).map((skill) => skill.label);
    if (![term.label, term.name, ...labels].some((phrase) => hasPhrase(index, phrase))) missing.push(term.label);
  }
  const coverage = terms.length ? (terms.length - missing.length) / terms.length : 1;
  return { coverage, missing, total: terms.length };
}

/** The pass/fail report for one rendered resume. Keyword coverage is reported and flagged, but only structure fails it. */
export function atsCheck(input: { text: string; pages: number; profile: CareerProfile; requirements: Requirements | null }): AtsReport {
  const lines = input.text.split('\n').map(fold).filter(Boolean);
  const text = lines.join(' ');
  const structure = [
    ...contactChecks(text, input.profile),
    headingCheck(lines, input.profile),
    roleCheck(text, input.profile),
    pageCheck(input.pages),
  ];
  const keywords = input.requirements ? keywordCoverage(input.text, input.profile, input.requirements) : { coverage: 1, missing: [], total: 0 };
  const found = keywords.total - keywords.missing.length;
  const keywordNote = keywords.missing.length ? `${found} of ${keywords.total} job terms found; missing ${keywords.missing.join(', ')}` : `All ${keywords.total} job terms found`;
  return {
    passed: structure.every((check) => check.ok),
    pages: input.pages,
    keywordCoverage: Math.round(keywords.coverage * 100) / 100,
    missingKeywords: keywords.missing,
    checks: [...structure, { id: 'keywords', ok: keywords.coverage >= KEYWORD_TARGET, note: keywordNote }],
  };
}
