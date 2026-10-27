import { test } from 'vitest';
import assert from 'node:assert/strict';
import { SKILL_ALIASES, TITLE_SYNONYMS, isKnownSkill, normaliseSkill, relatedSkills, sameSkill, skillsMentioned, titleSynonymGroups, titleTokens } from './skills.ts';

test('common spellings resolve to one canonical skill', () => {
  const cases: Array<[string, string]> = [
    ['JS', 'javascript'], ['ES6', 'javascript'], ['TS', 'typescript'], ['React.js', 'react'], ['ReactJS', 'react'],
    ['React JS', 'react'], ['Node', 'node.js'], ['NodeJS', 'node.js'], ['Node.js', 'node.js'], ['k8s', 'kubernetes'],
    ['Postgres', 'postgresql'], ['GCP', 'google cloud'], ['ML', 'machine learning'], ['CI/CD', 'ci/cd'], ['CI CD', 'ci/cd'],
    ['Next', 'next.js'], ['NextJS', 'next.js'], ['Golang', 'go'], ['C#', 'c#'], ['C++', 'c++'], ['.NET Core', '.net'],
    ['Tailwind', 'tailwind css'], ['SCSS', 'sass'], ['Spring Boot', 'spring boot'], ['Vue.js', 'vue'],
  ];
  for (const [raw, canonical] of cases) assert.equal(normaliseSkill(raw), canonical, raw);
});

test('punctuation, versions, parentheticals and plurals are tidied away', () => {
  assert.equal(normaliseSkill('  React.  '), 'react');
  assert.equal(normaliseSkill('Angular 14'), 'angular');
  assert.equal(normaliseSkill('Python 3.11'), 'python');
  assert.equal(normaliseSkill('Java (Spring Boot)'), 'java');
  assert.equal(normaliseSkill('REST APIs'), 'rest api');
  assert.equal(normaliseSkill('Microservices'), 'microservices');
});

test('unknown skills come back lowercase and trimmed', () => {
  assert.equal(normaliseSkill('  Elm  Lang '), 'elm lang');
  assert.equal(isKnownSkill('Elm'), false);
  assert.equal(isKnownSkill('reactjs'), true);
});

test('every alias in the vocabulary lands on its own canonical name (no collisions)', () => {
  for (const [canonical, aliases] of Object.entries(SKILL_ALIASES)) {
    assert.equal(normaliseSkill(canonical), canonical, canonical);
    for (const alias of aliases) assert.equal(normaliseSkill(alias), canonical, `${alias} → ${canonical}`);
  }
  assert.ok(Object.keys(SKILL_ALIASES).length >= 150);
});

test('sameSkill compares canonical names', () => {
  assert.equal(sameSkill('ReactJS', 'react'), true);
  assert.equal(sameSkill('Java', 'JavaScript'), false);
  assert.equal(sameSkill('', ''), false);
});

test('related skills are near-equivalents, never the skill itself', () => {
  const react = relatedSkills('React.js');
  assert.ok(react.includes('next.js') && react.includes('preact'));
  assert.ok(!react.includes('react'));
  assert.ok(relatedSkills('postgres').includes('mysql'));
  assert.ok(relatedSkills('aws').includes('google cloud') && relatedSkills('aws').includes('azure'));
  assert.deepEqual(relatedSkills('elm'), []);
});

test('title tokens drop stopwords, seniority and numbers, and join compound words', () => {
  assert.deepEqual(titleTokens('Senior Front-End Engineer II (Remote)'), ['frontend', 'engineer']);
  assert.deepEqual(titleTokens('Sr. Software Developer - Full Stack'), ['software', 'developer', 'fullstack']);
  assert.deepEqual(titleTokens('Lead Back end Engineer, Payments'), ['backend', 'engineer', 'payments']);
});

test('synonym groups are found by whole phrase', () => {
  const frontend = TITLE_SYNONYMS[0];
  assert.ok(titleSynonymGroups('Sr. Front End Developer').includes(frontend));
  assert.ok(titleSynonymGroups('UI Engineer').includes(frontend));
  assert.ok(!titleSynonymGroups('Backend Engineer').includes(frontend));
  // SDE and software engineer are one group; DevOps and SRE another.
  assert.deepEqual(titleSynonymGroups('SDE 2'), titleSynonymGroups('Software Engineer'));
  assert.deepEqual(titleSynonymGroups('SRE'), titleSynonymGroups('Platform Engineer'));
});

test('data scientist and ML engineer are not synonyms', () => {
  const scientist = titleSynonymGroups('Data Scientist');
  const ml = titleSynonymGroups('ML Engineer');
  assert.equal(scientist.length, 1);
  assert.equal(ml.length, 1);
  assert.notDeepEqual(scientist, ml);
});

test('owner synonym groups join the built-in ones', () => {
  const extra = [['frontend', 'web developer']];
  assert.ok(titleSynonymGroups('Web Developer', extra).includes(extra[0]));
});

test('skills named in prose, longest phrase first, ambiguous words skipped', () => {
  const found = skillsMentioned('Built a React Native app in TypeScript with a Node.js backend');
  assert.ok(found.includes('react native') && found.includes('typescript') && found.includes('node.js'));
  assert.ok(!found.includes('react'));
  assert.deepEqual(skillsMentioned('Helped the team go live with the rest of the next release'), []);
  assert.deepEqual(skillsMentioned('Migrated REST APIs to GraphQL.').sort((a, b) => a.localeCompare(b)), ['graphql', 'rest api']);
});
