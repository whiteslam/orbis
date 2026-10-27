/**
 * Career: the cheap gate before any AI (design: Pipeline → Prefilter).
 *
 * A job goes on to requirements extraction only when its title is plausibly
 * one of the owner's target roles and no deal-breaker word is in it. Jobs that
 * fail stay stored, scored 0 and labelled "not your role". It is deliberately
 * loose: the match step does the real judging, this only saves AI calls on
 * the hundreds of obviously unrelated listings a feed returns.
 */
import type { CareerSettings, CareerSpec } from './types.ts';
import { isKnownSkill, normaliseSkill, titleSynonymGroups, titleTokens, titleWords } from './skills.ts';

// Words that name a kind of job, not which one: "Backend Engineer" and
// "Frontend Engineer" share "engineer" and nothing that matters.
const GENERIC_TITLE_WORDS = new Set([
  'engineer', 'engineering', 'developer', 'development', 'dev', 'programmer', 'specialist', 'consultant', 'manager',
  'analyst', 'associate', 'executive', 'officer', 'team', 'member', 'expert', 'professional', 'staff', 'opportunity',
  'work', 'from', 'home', 'based', 'india', 'global',
]);

/**
 * The tokens of a title that can carry a match, skill spellings made canonical
 * ("React.js Developer" and "React Developer" share "react"); all of them when
 * every one is generic ("Developer").
 */
function meaningfulTokens(title: string) {
  const tokens = titleTokens(title).map((token) => (isKnownSkill(token) ? normaliseSkill(token) : token));
  const specific = tokens.filter((token) => !GENERIC_TITLE_WORDS.has(token));
  return specific.length ? specific : tokens;
}

/** True when a job title is plausibly the target role: a shared synonym group or a shared meaningful word. */
export function titleFitsRole(title: string, role: string, extraSynonyms: readonly string[][] = []): boolean {
  const roleGroups = titleSynonymGroups(role, extraSynonyms);
  if (roleGroups.length) {
    const titleGroups = titleSynonymGroups(title, extraSynonyms);
    if (titleGroups.some((group) => roleGroups.includes(group))) return true;
  }
  const roleTokens = new Set(meaningfulTokens(role));
  return meaningfulTokens(title).some((token) => roleTokens.has(token));
}

/**
 * The first deal-breaker named in the text as a whole word or phrase (a plural
 * "s" allowed), or null. Whole words only: "crypto" must not exclude a
 * cryptography role.
 */
export function dealBreakerIn(text: string, dealBreakers: readonly string[]): string | null {
  const padded = ` ${titleWords(text).join(' ')} `;
  for (const breaker of dealBreakers) {
    const words = titleWords(breaker);
    if (!words.length) continue;
    const phrase = words.join(' ');
    if (padded.includes(` ${phrase} `) || padded.includes(` ${phrase}s `)) return breaker.trim();
  }
  return null;
}

export type PrefilterResult = { pass: boolean; reason: string | null };

export function prefilter(job: { title: string }, spec: CareerSpec, settings: Pick<CareerSettings, 'synonyms'>): PrefilterResult {
  const breaker = dealBreakerIn(job.title, spec.dealBreakers);
  if (breaker) return { pass: false, reason: `Deal-breaker in title: ${breaker}` };
  // No target roles yet: nothing to filter on, so everything goes through.
  if (!spec.roles.length) return { pass: true, reason: null };
  const fits = spec.roles.some((role) => titleFitsRole(job.title, role, settings.synonyms));
  return fits ? { pass: true, reason: null } : { pass: false, reason: 'Not your role' };
}
