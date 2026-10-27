/**
 * Career: the profile — ids, validation, merging a re-uploaded resume, and
 * years per skill. Client-safe and pure.
 */
import type { CareerContact, CareerEducation, CareerFact, CareerProfile, CareerProject, CareerRole, CareerSkill } from './types.ts';
import { normaliseSkill, skillsMentioned } from './skills.ts';
import { isRecord, normaliseCompany, normaliseTitle } from './normalise.ts';

export type IdPrefix = 'f' | 'r' | 'e' | 'p' | 'c';

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** 'f_' + 8 base36 chars. Crypto randomness, since ids end up in URLs and citations. */
export function newId(prefix: IdPrefix): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  let id = `${prefix}_`;
  for (const byte of bytes) id += ID_ALPHABET[byte % 36];
  return id;
}

export function isId(value: unknown, prefix: IdPrefix): value is string {
  if (typeof value !== 'string' || value.length !== 10 || !value.startsWith(`${prefix}_`)) return false;
  for (const char of value.slice(2)) if (!ID_ALPHABET.includes(char)) return false;
  return true;
}

export function emptyProfile(): CareerProfile {
  return {
    contact: { name: '', email: '', phone: null, location: null, links: [] },
    headline: null,
    summary: null,
    roles: [],
    education: [],
    certifications: [],
    projects: [],
    skills: [],
    facts: [],
    languages: [],
  };
}

// ─── Validation ─────────────────────────────────────────────────────────

/** Caps on what a stored profile may hold. Generous for a real career, tight enough to bound prompts. */
export const PROFILE_CAPS = {
  name: 120, email: 254, phone: 40, location: 120, links: 10, linkLabel: 40, url: 500,
  headline: 200, summary: 2000,
  roles: 40, roleTitle: 150, employer: 150,
  education: 15, institution: 200, degree: 150, field: 150, grade: 40,
  certifications: 40, certName: 200, issuer: 150,
  projects: 30, projectName: 150, projectFacts: 20,
  skills: 150, skillName: 60,
  facts: 400, factText: 500, factSkills: 20,
  languages: 20, language: 40,
  years: 60,
} as const;

// Validation is strict: any wrong type, over-long string or over-full list
// rejects the whole profile, because it is the source of truth for everything sent.
const INVALID = Symbol('invalid');
type Checked<T> = T | typeof INVALID;

function str(value: unknown, max: number, allowEmpty = false): Checked<string> {
  if (typeof value !== 'string') return INVALID;
  const text = value.trim();
  if (text.length > max || (!allowEmpty && !text)) return INVALID;
  return text;
}

function nullableStr(value: unknown, max: number): Checked<string | null> {
  if (value === null || value === undefined) return null;
  const text = str(value, max, true);
  if (text === INVALID) return INVALID;
  return text || null;
}

function list<T>(value: unknown, max: number, item: (entry: unknown) => Checked<T>): Checked<T[]> {
  if (!Array.isArray(value) || value.length > max) return INVALID;
  const out: T[] = [];
  for (const entry of value) {
    const checked = item(entry);
    if (checked === INVALID) return INVALID;
    out.push(checked);
  }
  return out;
}

function digits(text: string) {
  for (const char of text) if (char < '0' || char > '9') return false;
  return text.length > 0;
}

/** 'YYYY-MM' with a real month and a plausible year. */
export function isYearMonth(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 7 || value[4] !== '-') return false;
  const year = value.slice(0, 4);
  const month = value.slice(5);
  if (!digits(year) || !digits(month)) return false;
  const y = Number.parseInt(year, 10);
  const m = Number.parseInt(month, 10);
  return y >= 1950 && y <= 2100 && m >= 1 && m <= 12;
}

function isYear(value: unknown): value is string {
  return typeof value === 'string' && value.length === 4 && digits(value) && value >= '1950' && value <= '2100';
}

function nullableDate(value: unknown, allowYear: boolean): Checked<string | null> {
  if (value === null || value === undefined) return null;
  if (isYearMonth(value) || (allowYear && isYear(value))) return value;
  return INVALID;
}

/** Empty, or one "@" with a dotted domain and no spaces. */
export function isEmailLike(text: string): boolean {
  if (!text) return true;
  const at = text.indexOf('@');
  return at > 0 && at === text.lastIndexOf('@') && text.indexOf('.', at) > at + 1 && !text.includes(' ');
}

function contactOf(value: unknown): Checked<CareerContact> {
  if (!isRecord(value)) return INVALID;
  const name = str(value.name, PROFILE_CAPS.name, true);
  const email = str(value.email, PROFILE_CAPS.email, true);
  const phone = nullableStr(value.phone, PROFILE_CAPS.phone);
  const location = nullableStr(value.location, PROFILE_CAPS.location);
  const links = list(value.links ?? [], PROFILE_CAPS.links, (link) => {
    if (!isRecord(link)) return INVALID;
    const label = str(link.label, PROFILE_CAPS.linkLabel);
    const url = str(link.url, PROFILE_CAPS.url);
    if (label === INVALID || url === INVALID) return INVALID;
    return { label, url };
  });
  if (name === INVALID || email === INVALID || phone === INVALID || location === INVALID || links === INVALID) return INVALID;
  if (!isEmailLike(email)) return INVALID;
  return { name, email, phone, location, links };
}

function roleOf(value: unknown): Checked<CareerRole> {
  if (!isRecord(value) || !isId(value.id, 'r') || !isYearMonth(value.start)) return INVALID;
  const title = str(value.title, PROFILE_CAPS.roleTitle);
  const employer = str(value.employer, PROFILE_CAPS.employer);
  const location = nullableStr(value.location, PROFILE_CAPS.location);
  const end = nullableDate(value.end, false);
  if (title === INVALID || employer === INVALID || location === INVALID || end === INVALID) return INVALID;
  if (end !== null && end < value.start) return INVALID;
  return { id: value.id, title, employer, location, start: value.start, end };
}

function educationOf(value: unknown): Checked<CareerEducation> {
  if (!isRecord(value) || !isId(value.id, 'e')) return INVALID;
  const institution = str(value.institution, PROFILE_CAPS.institution);
  const degree = str(value.degree, PROFILE_CAPS.degree, true);
  const field = nullableStr(value.field, PROFILE_CAPS.field);
  const end = nullableDate(value.end, true);
  const grade = nullableStr(value.grade, PROFILE_CAPS.grade);
  if (institution === INVALID || degree === INVALID || field === INVALID || end === INVALID || grade === INVALID) return INVALID;
  return { id: value.id, institution, degree, field, end, grade };
}

type Certification = CareerProfile['certifications'][number];

function certificationOf(value: unknown): Checked<Certification> {
  if (!isRecord(value) || !isId(value.id, 'c')) return INVALID;
  const name = str(value.name, PROFILE_CAPS.certName);
  const issuer = nullableStr(value.issuer, PROFILE_CAPS.issuer);
  const year = isYear(value.year) ? value.year : null;
  const yearGiven = value.year !== null && value.year !== undefined;
  if (name === INVALID || issuer === INVALID || (yearGiven && year === null)) return INVALID;
  return { id: value.id, name, issuer, year };
}

function skillNames(value: unknown, max: number): Checked<string[]> {
  const names = list(value, max, (entry) => str(entry, PROFILE_CAPS.skillName));
  if (names === INVALID) return INVALID;
  return [...new Set(names.map(normaliseSkill).filter(Boolean))];
}

function factOf(value: unknown): Checked<CareerFact> {
  if (!isRecord(value) || !isId(value.id, 'f') || typeof value.confirmed !== 'boolean') return INVALID;
  const text = str(value.text, PROFILE_CAPS.factText);
  const roleId = isId(value.roleId, 'r') ? value.roleId : null;
  const roleGiven = value.roleId !== null && value.roleId !== undefined;
  const skills = skillNames(value.skills ?? [], PROFILE_CAPS.factSkills);
  if (text === INVALID || skills === INVALID || (roleGiven && roleId === null)) return INVALID;
  return { id: value.id, text, roleId, skills, confirmed: value.confirmed };
}

function projectOf(value: unknown): Checked<CareerProject> {
  if (!isRecord(value) || !isId(value.id, 'p')) return INVALID;
  const name = str(value.name, PROFILE_CAPS.projectName);
  const url = nullableStr(value.url, PROFILE_CAPS.url);
  const factIds = list(value.factIds ?? [], PROFILE_CAPS.projectFacts, (id) => (isId(id, 'f') ? id : INVALID));
  if (name === INVALID || url === INVALID || factIds === INVALID) return INVALID;
  return { id: value.id, name, url, factIds: [...new Set(factIds)] };
}

function skillOf(value: unknown): Checked<CareerSkill> {
  if (!isRecord(value)) return INVALID;
  const label = str(value.label ?? value.name, PROFILE_CAPS.skillName);
  const name = str(value.name, PROFILE_CAPS.skillName);
  const years = value.years ?? null;
  const yearsOk = years === null || (typeof years === 'number' && Number.isInteger(years) && years >= 0 && years <= PROFILE_CAPS.years);
  if (label === INVALID || name === INVALID || !yearsOk) return INVALID;
  return { name: normaliseSkill(name), label, years: years as number | null };
}

function uniqueIds(items: Array<{ id: string }>) {
  return new Set(items.map((item) => item.id)).size === items.length;
}

/** One entry per skill name; the later duplicate adds its years if the first had none. */
function dedupeSkills(skills: CareerSkill[]) {
  const byName = new Map<string, CareerSkill>();
  for (const skill of skills) {
    const seen = byName.get(skill.name);
    if (seen) seen.years = maxYears(seen.years, skill.years);
    else byName.set(skill.name, { ...skill });
  }
  return [...byName.values()];
}

/** Ids are unique and every reference points at something that exists. */
function referencesHold(profile: CareerProfile) {
  const all = [...profile.roles, ...profile.education, ...profile.certifications, ...profile.projects, ...profile.facts];
  if (!uniqueIds(all)) return false;
  const roleIds = new Set(profile.roles.map((role) => role.id));
  const factIds = new Set(profile.facts.map((fact) => fact.id));
  if (profile.facts.some((fact) => fact.roleId !== null && !roleIds.has(fact.roleId))) return false;
  return profile.projects.every((project) => project.factIds.every((id) => factIds.has(id)));
}

/** The profile when it is exactly the right shape and within the caps, else null. Skill names come back canonical. */
export function validateProfile(value: unknown): CareerProfile | null {
  if (!isRecord(value)) return null;
  const caps = PROFILE_CAPS;
  const contact = contactOf(value.contact);
  const headline = nullableStr(value.headline, caps.headline);
  const summary = nullableStr(value.summary, caps.summary);
  const roles = list(value.roles, caps.roles, roleOf);
  const education = list(value.education, caps.education, educationOf);
  const certifications = list(value.certifications, caps.certifications, certificationOf);
  const projects = list(value.projects, caps.projects, projectOf);
  const skills = list(value.skills, caps.skills, skillOf);
  const facts = list(value.facts, caps.facts, factOf);
  const languages = list(value.languages, caps.languages, (entry) => str(entry, caps.language));
  if (
    contact === INVALID || headline === INVALID || summary === INVALID || roles === INVALID || education === INVALID
    || certifications === INVALID || projects === INVALID || skills === INVALID || facts === INVALID || languages === INVALID
  ) return null;
  const profile: CareerProfile = {
    contact, headline, summary, roles, education, certifications, projects,
    skills: dedupeSkills(skills), facts, languages: [...new Set(languages)],
  };
  return referencesHold(profile) ? profile : null;
}

// ─── Merge ──────────────────────────────────────────────────────────────

function maxYears(a: number | null, b: number | null) {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/** Text compared loosely, so a re-parse that changes only spacing or case is the same fact. */
function factKey(text: string) {
  let out = '';
  let space = false;
  for (const char of text.toLowerCase()) {
    const word = (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9');
    if (word) {
      if (space && out) out += ' ';
      out += char;
      space = false;
    } else {
      space = true;
    }
  }
  return out;
}

function roleKey(role: CareerRole) {
  return `${normaliseCompany(role.employer)}|${normaliseTitle(role.title)}|${role.start}`;
}

/** Keep the owner's value unless it is empty. */
function keep<T>(existing: T | null, incoming: T | null): T | null {
  if (existing === null || existing === '') return incoming;
  return existing;
}

function mergeContact(existing: CareerContact, incoming: CareerContact): CareerContact {
  const urls = new Set(existing.links.map((link) => link.url.toLowerCase()));
  const links = [...existing.links, ...incoming.links.filter((link) => !urls.has(link.url.toLowerCase()))];
  return {
    name: existing.name || incoming.name,
    email: existing.email || incoming.email,
    phone: keep(existing.phone, incoming.phone),
    location: keep(existing.location, incoming.location),
    links: links.slice(0, PROFILE_CAPS.links),
  };
}

/** Roles: matched ones keep the existing row; new ones are added; none are dropped. Returns incoming id → kept id. */
function mergeRoles(existing: CareerRole[], incoming: CareerRole[]) {
  const roles = existing.map((role) => ({ ...role }));
  const byKey = new Map(roles.map((role) => [roleKey(role), role]));
  const takenIds = new Set(roles.map((role) => role.id));
  const roleMap = new Map<string, string>();
  for (const role of incoming) {
    const match = byKey.get(roleKey(role));
    if (match) {
      match.location = keep(match.location, role.location);
      // A newer resume that shows an end date closes a role still marked current.
      if (match.end === null && role.end !== null && role.end >= match.start) match.end = role.end;
      roleMap.set(role.id, match.id);
      continue;
    }
    const id = takenIds.has(role.id) ? newId('r') : role.id;
    takenIds.add(id);
    roles.push({ ...role, id });
    byKey.set(roleKey(role), roles.at(-1) as CareerRole);
    roleMap.set(role.id, id);
  }
  return { roles: roles.slice(0, PROFILE_CAPS.roles), roleMap };
}

/**
 * Facts: confirmed ones stay exactly as they are. An unconfirmed one survives
 * when the new resume still says it (keeping its id, so citations hold);
 * otherwise the new resume supersedes it. New facts are added.
 * Returns incoming id → kept id for the facts that made it.
 */
function mergeFacts(existing: CareerFact[], incoming: CareerFact[], roleMap: Map<string, string>) {
  const incomingByKey = new Map(incoming.map((fact) => [factKey(fact.text), fact]));
  const facts: CareerFact[] = [];
  const factMap = new Map<string, string>();
  const seenKeys = new Set<string>();
  for (const fact of existing) {
    const key = factKey(fact.text);
    const again = incomingByKey.get(key);
    const kept = keptFact(fact, again);
    if (!kept) continue;
    facts.push(kept);
    seenKeys.add(key);
    if (again) factMap.set(again.id, fact.id);
  }
  const takenIds = new Set(existing.map((fact) => fact.id));
  for (const fact of incoming) {
    const key = factKey(fact.text);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const added = addedFact(fact, takenIds, roleMap);
    facts.push(added);
    factMap.set(fact.id, added.id);
  }
  return { facts: facts.slice(0, PROFILE_CAPS.facts), factMap };
}

/** An existing fact after a re-upload: confirmed as is, repeated with skills unioned, otherwise gone. */
function keptFact(fact: CareerFact, again: CareerFact | undefined): CareerFact | null {
  if (fact.confirmed) return fact;
  if (!again) return null;
  return { ...fact, skills: [...new Set([...fact.skills, ...again.skills])].slice(0, PROFILE_CAPS.factSkills) };
}

/** A new fact, with a fresh id if its own is taken and its role id mapped to the merged role. */
function addedFact(fact: CareerFact, takenIds: Set<string>, roleMap: Map<string, string>): CareerFact {
  const id = takenIds.has(fact.id) ? newId('f') : fact.id;
  takenIds.add(id);
  const roleId = fact.roleId === null ? null : roleMap.get(fact.roleId) ?? null;
  return { ...fact, id, roleId };
}

function mergeSkills(existing: CareerSkill[], incoming: CareerSkill[]) {
  const byName = new Map(existing.map((skill) => [skill.name, { ...skill }]));
  for (const skill of incoming) {
    const seen = byName.get(skill.name);
    if (seen) seen.years = maxYears(seen.years, skill.years);
    else byName.set(skill.name, { ...skill });
  }
  return [...byName.values()].slice(0, PROFILE_CAPS.skills);
}

/** Existing items win; incoming ones whose key is new are added, with a fresh id if theirs is taken. */
function unionBy<T extends { id: string }>(existing: T[], incoming: T[], key: (item: T) => string, prefix: IdPrefix, cap: number) {
  const keys = new Set(existing.map(key));
  const ids = new Set(existing.map((item) => item.id));
  const out = [...existing];
  for (const item of incoming) {
    if (keys.has(key(item))) continue;
    keys.add(key(item));
    const id = ids.has(item.id) ? newId(prefix) : item.id;
    ids.add(id);
    out.push({ ...item, id });
  }
  return out.slice(0, cap);
}

function mergeProjects(existing: CareerProject[], incoming: CareerProject[], factMap: Map<string, string>, factIds: Set<string>) {
  const remapped = incoming.map((project) => ({
    ...project,
    factIds: project.factIds.map((id) => factMap.get(id)).filter((id): id is string => id !== undefined),
  }));
  const projects = unionBy(existing, remapped, (project) => factKey(project.name), 'p', PROFILE_CAPS.projects);
  return projects.map((project) => {
    const again = remapped.find((other) => factKey(other.name) === factKey(project.name));
    const merged = [...project.factIds, ...(again?.factIds ?? [])];
    // Facts the new resume superseded drop out of their projects too.
    const kept = [...new Set(merged)].filter((id) => factIds.has(id)).slice(0, PROFILE_CAPS.projectFacts);
    return { ...project, url: project.url ?? again?.url ?? null, factIds: kept };
  });
}

/**
 * A re-uploaded resume merged into the profile the owner has been editing.
 *
 * - Contact, headline, summary: the existing value wins unless it is empty.
 * - Roles: matched on employer + title + start (normalised). A match keeps the
 *   existing row and id, fills a missing location, and takes an end date when
 *   the existing role was still marked current. Unmatched roles are added.
 *   No role is ever dropped, since confirmed facts may point at it.
 * - Facts: confirmed facts are never dropped or changed. Unconfirmed facts
 *   the new resume repeats keep their id (skills unioned); unconfirmed facts
 *   it no longer says are dropped. New facts are added, linked to the merged roles.
 * - Skills: union by canonical name, years the larger of the two.
 * - Education, certifications, projects, languages: union; existing entries win.
 */
export function mergeProfiles(existing: CareerProfile, incoming: CareerProfile): CareerProfile {
  const { roles, roleMap } = mergeRoles(existing.roles, incoming.roles);
  const { facts, factMap } = mergeFacts(existing.facts, incoming.facts, roleMap);
  const factIds = new Set(facts.map((fact) => fact.id));
  // A role cut by the cap takes its new facts' link with it, never a dangling id.
  const roleIds = new Set(roles.map((role) => role.id));
  const linked = facts.map((fact) => (fact.roleId !== null && !roleIds.has(fact.roleId) ? { ...fact, roleId: null } : fact));
  const languages = [...existing.languages];
  for (const language of incoming.languages) {
    if (!languages.some((known) => known.toLowerCase() === language.toLowerCase())) languages.push(language);
  }
  return {
    contact: mergeContact(existing.contact, incoming.contact),
    headline: keep(existing.headline, incoming.headline),
    summary: keep(existing.summary, incoming.summary),
    roles,
    education: unionBy(existing.education, incoming.education, (item) => `${factKey(item.institution)}|${factKey(item.degree)}`, 'e', PROFILE_CAPS.education),
    certifications: unionBy(existing.certifications, incoming.certifications, (item) => factKey(item.name), 'c', PROFILE_CAPS.certifications),
    projects: mergeProjects(existing.projects, incoming.projects, factMap, factIds),
    skills: mergeSkills(existing.skills, incoming.skills),
    facts: linked,
    languages: languages.slice(0, PROFILE_CAPS.languages),
  };
}

// ─── Years per skill ────────────────────────────────────────────────────

/** Months since year 0, so intervals compare as integers. */
function monthIndex(yearMonth: string) {
  return Number.parseInt(yearMonth.slice(0, 4), 10) * 12 + Number.parseInt(yearMonth.slice(5, 7), 10) - 1;
}

/** A role as [first month, month after the last), inclusive of both ends; a current role runs to today. */
export function roleSpan(role: CareerRole, today: string): [number, number] | null {
  const start = monthIndex(role.start);
  const end = monthIndex(role.end ?? today.slice(0, 7)) + 1;
  return end > start ? [start, end] : null;
}

/** Total months covered by the spans, overlaps counted once. */
export function coveredMonths(spans: Array<[number, number]>): number {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cursor = Number.NEGATIVE_INFINITY;
  for (const [start, end] of sorted) {
    const from = Math.max(start, cursor);
    if (end > from) total += end - from;
    cursor = Math.max(cursor, end);
  }
  return total;
}

/** Years to one decimal. */
export function monthsToYears(months: number): number {
  return Math.round((months / 12) * 10) / 10;
}

/** Total experience: every role's span, overlaps counted once. */
export function totalYears(profile: CareerProfile, today: string): number {
  const spans = profile.roles.map((role) => roleSpan(role, today)).filter((span): span is [number, number] => span !== null);
  return monthsToYears(coveredMonths(spans));
}

/** Canonical skills a fact is evidence for: the ones it lists plus the ones its text names. */
export function factSkills(fact: CareerFact): string[] {
  return [...new Set([...fact.skills.map(normaliseSkill), ...skillsMentioned(fact.text)])];
}

/**
 * Years per canonical skill, to one decimal: the months of every role whose
 * facts cite the skill (or whose title names it), overlapping roles counted
 * once. A skill only facts outside any role back gets no entry.
 */
export function deriveSkillYears(profile: CareerProfile, today: string): Record<string, number> {
  const rolesBySkill = new Map<string, Set<string>>();
  const add = (skill: string, roleId: string) => {
    const set = rolesBySkill.get(skill) ?? new Set<string>();
    set.add(roleId);
    rolesBySkill.set(skill, set);
  };
  for (const fact of profile.facts) {
    if (fact.roleId === null) continue;
    for (const skill of factSkills(fact)) add(skill, fact.roleId);
  }
  for (const role of profile.roles) {
    for (const skill of skillsMentioned(role.title)) add(skill, role.id);
  }
  const roles = new Map(profile.roles.map((role) => [role.id, role]));
  const years: Record<string, number> = {};
  for (const [skill, roleIds] of rolesBySkill) {
    const spans: Array<[number, number]> = [];
    for (const id of roleIds) {
      const role = roles.get(id);
      const span = role ? roleSpan(role, today) : null;
      if (span) spans.push(span);
    }
    if (spans.length) years[skill] = monthsToYears(coveredMonths(spans));
  }
  return years;
}
