import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { CareerProfile } from './types.ts';
import { emptyProfile, validateProfile } from './profile.ts';
import { applySkillTree, cvLineState, readSkillTreeFile, skillsByBranch, treeSkillNames, treeSkillsFor, validateSkillTree, type SkillTree } from './skill-tree.ts';

const NOW = new Date('2026-11-10T08:00:00Z');

// The shape the tree's build script writes to public/data.js, made up and small.
const evidence = (count: number) => Array.from({ length: count }, (_, index) => ({
  h: (0xabc000 + index).toString(16).padStart(8, '0'),
  p: index % 2 ? 'Shop app' : 'Admin app',
  d: `2026-10-${String(1 + (index % 28)).padStart(2, '0')}`,
  s: `Commit number ${index}`,
}));

const RAW = {
  version: 'abc123',
  branches: [
    { id: 'frontend', name: 'Frontend Engineering', color: '#FFCB6B' },
    { id: 'databases', name: 'Database Engineering', color: '#7FE8D6' },
  ],
  nodes: [
    { id: 'frontend', branch: 'frontend', kind: 'hub', name: 'Frontend Engineering', level: 0, commits: 0, files: 0 },
    {
      id: 'frontendarch', branch: 'frontend', kind: 'skill', name: 'Frontend Architecture', about: 'Deciding how pages fit together.',
      cv: 'Structured pages and shared navigation for a production web app.', tools: ['Next.js (App Router)', 'React', 'TypeScript'],
      level: 5, commits: 289, files: 3405, first: '2026-07-02', x: 1, y: 2, parent: 'frontend', evidence: evidence(25),
    },
    {
      id: 'dbsecurity', branch: 'databases', kind: 'skill', name: 'Database Security', about: 'Keeping rows to their owners.',
      cv: 'Protected sensitive tables with row-level security policies.', tools: ['PostgreSQL Row-Level Security', 'Supabase'],
      level: 3, commits: 9, files: 40, first: '2026-08-01', evidence: evidence(3),
    },
    { id: 'locked', branch: 'databases', kind: 'skill', name: 'Not yet', about: 'x', cv: 'x', tools: [], level: 0, locked: true, commits: 0, files: 0 },
  ],
  timeline: ['2026-07-02'],
  stats: { commits: 300, activeDays: 40, from: '2026-07-02', to: '2026-11-06', projects: [{ name: 'Shop app', commits: 200 }, { name: 'Admin app', commits: 100 }] },
};

const dataJs = `window.TREE = ${JSON.stringify(RAW)};\n`;

function tree(): SkillTree {
  const read = readSkillTreeFile(dataJs, NOW);
  assert.ok(read);
  return read;
}

test('reads data.js into the compact tree: skills only, unlocked, newest ten proof commits', () => {
  const read = tree();
  assert.equal(read.version, 'abc123');
  assert.equal(read.importedAt, NOW.toISOString());
  assert.deepEqual(read.skills.map((skill) => skill.id), ['frontendarch', 'dbsecurity']);
  const arch = read.skills[0];
  assert.equal(arch.proof.length, 10);
  assert.ok(arch.proof.every((entry, index, all) => index === 0 || all[index - 1].date >= entry.date));
  assert.equal(arch.factId, null);
  assert.equal(read.stats.projects.length, 2);
  assert.ok(!('x' in arch));
});

test('reads bare JSON too, and refuses what is not a tree', () => {
  assert.ok(readSkillTreeFile(JSON.stringify(RAW), NOW));
  assert.equal(readSkillTreeFile('hello', NOW), null);
  assert.equal(readSkillTreeFile('{"nodes": []}', NOW), null);
  assert.equal(readSkillTreeFile(JSON.stringify({ ...RAW, nodes: [] }), NOW), null);
});

test('validation is strict: unknown branches, bad colours and duplicate ids are refused', () => {
  const read = tree();
  assert.ok(validateSkillTree(read));
  assert.equal(validateSkillTree({ ...read, skills: [{ ...read.skills[0], branch: 'nope' }] }), null);
  assert.equal(validateSkillTree({ ...read, branches: [{ ...read.branches[0], color: 'red;background:url(x)' }, read.branches[1]] }), null);
  assert.equal(validateSkillTree({ ...read, skills: [read.skills[0], read.skills[0]] }), null);
  assert.equal(validateSkillTree({ ...read, skills: [{ ...read.skills[0], level: 9 }] }), null);
  assert.equal(validateSkillTree({ ...read, skills: [{ ...read.skills[0], factId: 'not-an-id' }] }), null);
});

test('a skill is evidence for its tools and its own name', () => {
  const names = treeSkillNames(tree().skills[0]);
  for (const name of ['next.js', 'react', 'typescript']) assert.ok(names.includes(name), name);
  assert.ok(names.includes('frontend architecture'));
});

test('applying adds skills and one unconfirmed fact per CV line, into a valid profile', () => {
  const applied = applySkillTree(null, tree(), null);
  const profile = validateProfile(applied.profile);
  assert.ok(profile, 'the result validates');
  assert.equal(applied.added.facts, 2);
  assert.ok(applied.added.skills >= 5);
  assert.ok(profile.facts.every((fact) => !fact.confirmed && fact.roleId === null));
  assert.ok(applied.tree.skills.every((skill) => skill.factId && profile.facts.some((fact) => fact.id === skill.factId)));
  assert.ok(profile.skills.some((skill) => skill.label === 'Next.js (App Router)'));
});

test('the owner’s own skills, labels and facts are kept as they are', () => {
  const mine: CareerProfile = {
    ...emptyProfile(),
    skills: [{ name: 'react', label: 'ReactJS', years: 4 }],
    facts: [{ id: 'f_owner001', text: 'Shipped a design system.', roleId: null, skills: ['react'], confirmed: true }],
  };
  const applied = applySkillTree(mine, tree(), null);
  assert.deepEqual(applied.profile.skills.find((skill) => skill.name === 'react'), { name: 'react', label: 'ReactJS', years: 4 });
  assert.deepEqual(applied.profile.facts[0], mine.facts[0]);
});

test('a re-upload updates its own unconfirmed facts, and leaves confirmed ones alone', () => {
  const first = applySkillTree(null, tree(), null);
  const confirmedId = first.tree.skills[1].factId;
  const profile: CareerProfile = {
    ...first.profile,
    facts: first.profile.facts.map((fact) => (fact.id === confirmedId ? { ...fact, confirmed: true } : fact)),
  };
  const newer = tree();
  newer.skills = newer.skills.map((skill) => ({ ...skill, cv: `${skill.cv} Now with more.` }));
  const second = applySkillTree(profile, newer, first.tree);
  assert.equal(second.added.facts, 0);
  assert.equal(second.added.updated, 1);
  assert.equal(second.profile.facts.length, profile.facts.length);
  const changed = second.profile.facts.find((fact) => fact.id === first.tree.skills[0].factId);
  assert.match(changed?.text ?? '', /Now with more/);
  const kept = second.profile.facts.find((fact) => fact.id === confirmedId);
  assert.doesNotMatch(kept?.text ?? '', /Now with more/);
  assert.deepEqual(second.tree.skills.map((skill) => skill.factId), first.tree.skills.map((skill) => skill.factId));
});

test('the same CV line already in the profile is reused, not repeated', () => {
  const read = tree();
  const mine: CareerProfile = { ...emptyProfile(), facts: [{ id: 'f_owner002', text: read.skills[1].cv, roleId: null, skills: [], confirmed: true }] };
  const applied = applySkillTree(mine, read, null);
  assert.equal(applied.added.facts, 1);
  assert.equal(applied.tree.skills[1].factId, 'f_owner002');
  assert.ok(applied.profile.facts[0].skills.includes('supabase'));
  assert.equal(applied.profile.facts[0].confirmed, true);
});

test('screens: grouped by branch, CV line state, and the tree skills a job asks for', () => {
  const applied = applySkillTree(null, tree(), null);
  const groups = skillsByBranch(applied.tree);
  assert.deepEqual(groups.map((group) => group.branch.id), ['frontend', 'databases']);
  assert.equal(cvLineState(applied.tree.skills[0], applied.profile), 'waiting');
  assert.equal(cvLineState(applied.tree.skills[0], emptyProfile()), 'missing');
  assert.deepEqual(treeSkillsFor(applied.tree, ['Supabase', 'Go']).map((skill) => skill.id), ['dbsecurity']);
});
