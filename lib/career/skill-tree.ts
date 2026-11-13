/**
 * Career: the owner's skill tree. Client-safe and pure.
 *
 * The skill tree is built on the owner's PC from their own commits (the
 * "Gaurav SKILL tree" folder, outside this repo): branches of skills, each
 * with a level from 1 to 5, the tools used, a CV line, and the commits that
 * prove it. Its public/data.js is uploaded from Career → Skills:
 *
 *   readSkillTreeFile  data.js (or its JSON) → the compact SkillTree, in the
 *                      browser, so only the trimmed tree is sent
 *   validateSkillTree  the server's strict check of what the browser sent
 *   applySkillTree     the tree into the profile: its tools and skill names
 *                      become profile skills, and each CV line becomes an
 *                      unconfirmed fact citing them. Matching counts a skill
 *                      once a fact cites it (match.ts), so jobs score against
 *                      the tree at once; tailoring waits for the owner to
 *                      confirm each line in Setup, like a parsed resume.
 *
 * A re-upload updates the facts it made earlier (found by the skill's
 * `factId`) unless the owner has since confirmed or edited them.
 */
import type { CareerFact, CareerProfile, CareerSkill } from './types.ts';
import { emptyProfile, isId, newId, PROFILE_CAPS } from './profile.ts';
import { normaliseSkill, skillsMentioned } from './skills.ts';
import { isRecord } from '../ai/json.ts';

export type SkillTreeProof = {
  /** Short commit hash. */
  hash: string;
  project: string;
  /** 'YYYY-MM-DD'. */
  date: string;
  text: string;
};

export type SkillTreeBranch = { id: string; name: string; color: string };

export type SkillTreeSkill = {
  id: string;
  branch: string;
  name: string;
  about: string;
  /** The line for a CV. */
  cv: string;
  tools: string[];
  /** 1–5, from how much commit proof backs it. */
  level: number;
  commits: number;
  files: number;
  /** 'YYYY-MM-DD' of the first commit that proves it. */
  first: string | null;
  /** The newest proof commits, newest first. */
  proof: SkillTreeProof[];
  /** The profile fact made from `cv`, set when the tree is applied. */
  factId: string | null;
};

export type SkillTree = {
  version: string;
  /** ISO time of the upload. */
  importedAt: string;
  branches: SkillTreeBranch[];
  skills: SkillTreeSkill[];
  stats: {
    commits: number;
    activeDays: number;
    from: string | null;
    to: string | null;
    projects: Array<{ name: string; commits: number }>;
  };
};

export const SKILL_TREE_CAPS = {
  branches: 12, skills: 80, tools: 12, proof: 10, projects: 10,
  id: 40, name: 80, about: 400, cv: PROFILE_CAPS.factText, tool: PROFILE_CAPS.skillName,
  project: 80, proofText: 200, version: 40, count: 10_000_000,
} as const;

/** Upload size the browser accepts for data.js before reading it. */
export const SKILL_TREE_FILE_MAX_BYTES = 5_000_000;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const HASH = /^[0-9a-f]{6,40}$/;
const SLUG = /^[a-z0-9_-]+$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const INVALID = Symbol('invalid');
type Checked<T> = T | typeof INVALID;

function text(value: unknown, max: number): Checked<string> {
  if (typeof value !== 'string') return INVALID;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : INVALID;
}

/** Long text is cut at a word with an ellipsis, rather than refused: proof lines are commit subjects. */
function clipped(value: unknown, max: number): Checked<string> {
  if (typeof value !== 'string') return INVALID;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return INVALID;
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s.,;:]+$/, '')}…`;
}

function count(value: unknown): Checked<number> {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= SKILL_TREE_CAPS.count ? value : INVALID;
}

function day(value: unknown): Checked<string | null> {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' && DAY.test(value) ? value : INVALID;
}

function slug(value: unknown): Checked<string> {
  const id = text(value, SKILL_TREE_CAPS.id);
  return id !== INVALID && SLUG.test(id) ? id : INVALID;
}

function branchOf(value: unknown): Checked<SkillTreeBranch> {
  if (!isRecord(value)) return INVALID;
  const id = slug(value.id);
  const name = text(value.name, SKILL_TREE_CAPS.name);
  const color = typeof value.color === 'string' && HEX_COLOR.test(value.color) ? value.color : INVALID;
  if (id === INVALID || name === INVALID || color === INVALID) return INVALID;
  return { id, name, color };
}

function proofOf(value: unknown): Checked<SkillTreeProof> {
  if (!isRecord(value)) return INVALID;
  const hash = typeof value.hash === 'string' && HASH.test(value.hash) ? value.hash : INVALID;
  const project = text(value.project, SKILL_TREE_CAPS.project);
  const date = day(value.date);
  const line = clipped(value.text, SKILL_TREE_CAPS.proofText);
  if (hash === INVALID || project === INVALID || date === INVALID || date === null || line === INVALID) return INVALID;
  return { hash, project, date, text: line };
}

function listOf<T>(value: unknown, max: number, item: (entry: unknown) => Checked<T>): Checked<T[]> {
  if (!Array.isArray(value) || value.length > max) return INVALID;
  const out: T[] = [];
  for (const entry of value) {
    const checked = item(entry);
    if (checked === INVALID) return INVALID;
    out.push(checked);
  }
  return out;
}

function skillOf(value: unknown): Checked<SkillTreeSkill> {
  if (!isRecord(value)) return INVALID;
  const id = slug(value.id);
  const branch = slug(value.branch);
  const name = text(value.name, SKILL_TREE_CAPS.name);
  const about = text(value.about, SKILL_TREE_CAPS.about);
  const cv = text(value.cv, SKILL_TREE_CAPS.cv);
  const tools = listOf(value.tools ?? [], SKILL_TREE_CAPS.tools, (tool) => text(tool, SKILL_TREE_CAPS.tool));
  const level = typeof value.level === 'number' && Number.isInteger(value.level) && value.level >= 1 && value.level <= 5 ? value.level : INVALID;
  const commits = count(value.commits);
  const files = count(value.files);
  const first = day(value.first);
  const proof = listOf(value.proof ?? [], SKILL_TREE_CAPS.proof, proofOf);
  const factId = value.factId === null || value.factId === undefined ? null : isId(value.factId, 'f') ? value.factId : INVALID;
  if (
    id === INVALID || branch === INVALID || name === INVALID || about === INVALID || cv === INVALID || tools === INVALID
    || level === INVALID || commits === INVALID || files === INVALID || first === INVALID || proof === INVALID || factId === INVALID
  ) return INVALID;
  return { id, branch, name, about, cv, tools: [...new Set(tools)], level, commits, files, first, proof, factId };
}

/** The tree when it is exactly the right shape and within the caps, else null. */
export function validateSkillTree(value: unknown): SkillTree | null {
  if (!isRecord(value) || !isRecord(value.stats)) return null;
  const version = text(value.version, SKILL_TREE_CAPS.version);
  const importedAt = typeof value.importedAt === 'string' && !Number.isNaN(Date.parse(value.importedAt)) ? value.importedAt : INVALID;
  const branches = listOf(value.branches, SKILL_TREE_CAPS.branches, branchOf);
  const skills = listOf(value.skills, SKILL_TREE_CAPS.skills, skillOf);
  const stats = value.stats;
  const commits = count(stats.commits);
  const activeDays = count(stats.activeDays);
  const from = day(stats.from);
  const to = day(stats.to);
  const projects = listOf(stats.projects ?? [], SKILL_TREE_CAPS.projects, (entry) => {
    if (!isRecord(entry)) return INVALID;
    const name = text(entry.name, SKILL_TREE_CAPS.project);
    const made = count(entry.commits);
    return name === INVALID || made === INVALID ? INVALID : { name, commits: made };
  });
  if (
    version === INVALID || importedAt === INVALID || branches === INVALID || skills === INVALID || commits === INVALID
    || activeDays === INVALID || from === INVALID || to === INVALID || projects === INVALID
  ) return null;
  if (!branches.length || !skills.length) return null;
  const branchIds = new Set(branches.map((branch) => branch.id));
  if (branchIds.size !== branches.length) return null;
  if (new Set(skills.map((skill) => skill.id)).size !== skills.length) return null;
  if (skills.some((skill) => !branchIds.has(skill.branch))) return null;
  return { version, importedAt, branches, skills, stats: { commits, activeDays, from, to, projects } };
}

// ─── Reading data.js ───────────────────────────────────────────────────────

/** `window.TREE = {…};` or bare JSON → the object, or null. */
function parseTreeText(source: string): unknown {
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(source.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * The skill tree's data.js (or its JSON) as the compact SkillTree, or null
 * when it isn't one. Branch hubs, locked skills and the layout are left out;
 * proof keeps the newest commits only.
 */
export function readSkillTreeFile(source: string, now: Date = new Date()): SkillTree | null {
  const raw = parseTreeText(source);
  if (!isRecord(raw) || !Array.isArray(raw.branches) || !Array.isArray(raw.nodes)) return null;
  const stats = isRecord(raw.stats) ? raw.stats : {};
  const skills = raw.nodes
    .filter((node): node is Record<string, unknown> => isRecord(node) && node.kind === 'skill' && node.locked !== true && typeof node.level === 'number' && node.level >= 1)
    .map((node) => {
      const evidence = Array.isArray(node.evidence) ? node.evidence.filter(isRecord) : [];
      const proof = evidence
        .map((entry) => ({ hash: entry.h, project: entry.p, date: entry.d, text: entry.s }))
        .filter((entry) => proofOf(entry) !== INVALID)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, SKILL_TREE_CAPS.proof)
        .map((entry) => proofOf(entry) as SkillTreeProof);
      return {
        id: node.id, branch: node.branch, name: node.name, about: node.about, cv: node.cv,
        tools: Array.isArray(node.tools) ? node.tools.slice(0, SKILL_TREE_CAPS.tools) : [],
        level: node.level, commits: node.commits, files: node.files, first: node.first ?? null, proof, factId: null,
      };
    });
  const projects = Array.isArray(stats.projects) ? stats.projects.slice(0, SKILL_TREE_CAPS.projects) : [];
  return validateSkillTree({
    version: raw.version,
    importedAt: now.toISOString(),
    branches: raw.branches.map((branch) => (isRecord(branch) ? { id: branch.id, name: branch.name, color: branch.color } : branch)),
    skills,
    stats: { commits: stats.commits ?? 0, activeDays: stats.activeDays ?? 0, from: stats.from ?? null, to: stats.to ?? null, projects },
  });
}

// ─── Into the profile ──────────────────────────────────────────────────────

/** The profile skill names one tree skill is evidence for: its tools, and its own name. */
export function treeSkillNames(skill: Pick<SkillTreeSkill, 'name' | 'tools'>): string[] {
  const names = new Set<string>();
  for (const tool of skill.tools) {
    names.add(normaliseSkill(tool));
    for (const mentioned of skillsMentioned(tool)) names.add(mentioned);
  }
  names.add(normaliseSkill(skill.name));
  for (const mentioned of skillsMentioned(skill.name)) names.add(mentioned);
  names.delete('');
  return [...names].slice(0, PROFILE_CAPS.factSkills);
}

/** Display labels for the names above: the tool as written where there is one. */
function labelsFor(skill: SkillTreeSkill): Map<string, string> {
  const labels = new Map<string, string>();
  for (const tool of skill.tools) {
    const name = normaliseSkill(tool);
    if (name && !labels.has(name)) labels.set(name, tool);
  }
  const own = normaliseSkill(skill.name);
  if (own && !labels.has(own)) labels.set(own, skill.name);
  return labels;
}

export type SkillTreeApplied = {
  profile: CareerProfile;
  tree: SkillTree;
  added: { skills: number; facts: number; updated: number };
  /** Skills or facts left out because the profile was full. */
  skipped: number;
};

/** What importSkillTreeAction answers: the stored tree, the profile it went into, and what changed. */
export type SkillTreeImport = SkillTreeApplied & { rescored: number };

function sameList(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

/**
 * Puts `incoming` into `profile` (an empty one when there is none yet):
 * - Every tool and skill name becomes a profile skill, unless one with that
 *   name is already there (the owner's label and years win).
 * - Each CV line becomes an unconfirmed fact, citing those skills. A fact the
 *   last upload made is updated in place while it is still unconfirmed, and
 *   left alone once the owner has confirmed or edited it. The same CV line
 *   already in the profile is reused rather than repeated.
 * Nothing the owner wrote is removed or changed.
 */
export function applySkillTree(profile: CareerProfile | null, incoming: SkillTree, previous: SkillTree | null): SkillTreeApplied {
  const base = profile ?? emptyProfile();
  const skills: CareerSkill[] = base.skills.map((skill) => ({ ...skill }));
  const facts: CareerFact[] = base.facts.map((fact) => ({ ...fact, skills: [...fact.skills] }));
  const known = new Set(skills.map((skill) => skill.name));
  const factIndex = new Map(facts.map((fact, index) => [fact.id, index]));
  const byText = new Map(facts.map((fact, index) => [fact.text.trim().toLowerCase(), index]));
  const earlier = new Map((previous?.skills ?? []).map((skill) => [skill.id, skill]));
  const added = { skills: 0, facts: 0, updated: 0 };
  let skipped = 0;

  const treeSkills = incoming.skills.map((skill) => {
    for (const [name, label] of labelsFor(skill)) {
      if (known.has(name)) continue;
      if (skills.length >= PROFILE_CAPS.skills) { skipped += 1; continue; }
      skills.push({ name, label, years: null });
      known.add(name);
      added.skills += 1;
    }

    const cites = treeSkillNames(skill);
    const before = earlier.get(skill.id);
    const madeAt = before?.factId ? factIndex.get(before.factId) : undefined;
    if (madeAt !== undefined) {
      const made = facts[madeAt];
      if (!made.confirmed && (made.text !== skill.cv || !sameList(made.skills, cites))) {
        facts[madeAt] = { ...made, text: skill.cv, skills: cites };
        added.updated += 1;
      }
      return { ...skill, factId: made.id };
    }
    const sameAt = byText.get(skill.cv.trim().toLowerCase());
    if (sameAt !== undefined) {
      const same = facts[sameAt];
      const union = [...new Set([...same.skills, ...cites])].slice(0, PROFILE_CAPS.factSkills);
      if (!sameList(union, same.skills)) facts[sameAt] = { ...same, skills: union };
      return { ...skill, factId: same.id };
    }
    if (facts.length >= PROFILE_CAPS.facts) {
      skipped += 1;
      return { ...skill, factId: null };
    }
    const fact: CareerFact = { id: newId('f'), text: skill.cv, roleId: null, skills: cites, confirmed: false };
    factIndex.set(fact.id, facts.length);
    byText.set(fact.text.trim().toLowerCase(), facts.length);
    facts.push(fact);
    added.facts += 1;
    return { ...skill, factId: fact.id };
  });

  return {
    profile: { ...base, skills, facts },
    tree: { ...incoming, skills: treeSkills },
    added,
    skipped,
  };
}

// ─── For screens ───────────────────────────────────────────────────────────

/** Skills per branch, in the tree's branch order, the highest level first. */
export function skillsByBranch(tree: SkillTree): Array<{ branch: SkillTreeBranch; skills: SkillTreeSkill[] }> {
  return tree.branches
    .map((branch) => ({
      branch,
      skills: tree.skills.filter((skill) => skill.branch === branch.id).sort((a, b) => b.level - a.level || b.commits - a.commits),
    }))
    .filter((group) => group.skills.length > 0);
}

/** Whether a tree skill's CV line is confirmed in the profile, waiting, or no longer there. */
export function cvLineState(skill: SkillTreeSkill, profile: CareerProfile | null): 'confirmed' | 'waiting' | 'missing' {
  const fact = skill.factId ? profile?.facts.find((entry) => entry.id === skill.factId) : undefined;
  if (!fact) return 'missing';
  return fact.confirmed ? 'confirmed' : 'waiting';
}

/**
 * The tree skills a job asks for, strongest first: a tree skill counts when
 * one of its names (treeSkillNames) is among the job's requirement skills.
 */
export function treeSkillsFor(tree: SkillTree, wanted: readonly string[]): SkillTreeSkill[] {
  const want = new Set(wanted.map(normaliseSkill));
  return tree.skills
    .filter((skill) => treeSkillNames(skill).some((name) => want.has(name)))
    .sort((a, b) => b.level - a.level || b.commits - a.commits);
}
