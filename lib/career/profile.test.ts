import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { CareerProfile } from './types.ts';
import { coveredMonths, deriveSkillYears, emptyProfile, isId, mergeProfiles, newId, totalYears, validateProfile } from './profile.ts';

const TODAY = '2026-10-27';

// An Indian frontend developer: Infosys, then Razorpay (current), overlapping by a few months.
const profile = (): CareerProfile => ({
  contact: { name: 'Aarav Sharma', email: 'aarav.sharma@gmail.com', phone: '+91 98765 43210', location: 'Bengaluru, India', links: [{ label: 'GitHub', url: 'https://github.com/aaravs' }] },
  headline: 'Frontend Engineer',
  summary: null,
  roles: [
    { id: 'r_razorpay', title: 'Frontend Engineer', employer: 'Razorpay', location: 'Bengaluru', start: '2021-11', end: null },
    { id: 'r_infosys1', title: 'Systems Engineer', employer: 'Infosys Limited', location: 'Pune', start: '2019-07', end: '2022-03' },
  ],
  education: [{ id: 'e_vitvelor', institution: 'VIT Vellore', degree: 'B.Tech', field: 'Computer Science', end: '2019', grade: '8.4 CGPA' }],
  certifications: [{ id: 'c_awsprac1', name: 'AWS Certified Cloud Practitioner', issuer: 'Amazon', year: '2023' }],
  projects: [{ id: 'p_vitepl01', name: 'vite-plugin-budget', url: 'https://github.com/aaravs/vite-plugin-budget', factIds: ['f_vitepl01'] }],
  skills: [{ name: 'ReactJS', label: 'React', years: null }, { name: 'typescript', label: 'TypeScript', years: null }],
  facts: [
    { id: 'f_checkout', text: 'Rebuilt the checkout page in React and TypeScript, cutting load time from 4.2 s to 1.6 s', roleId: 'r_razorpay', skills: ['react', 'typescript'], confirmed: true },
    { id: 'f_designsy', text: 'Led the design system used by 6 product teams', roleId: 'r_razorpay', skills: ['design systems'], confirmed: false },
    { id: 'f_angular1', text: 'Maintained an internal Angular dashboard for a banking client', roleId: 'r_infosys1', skills: ['angular'], confirmed: false },
    { id: 'f_vitepl01', text: 'Published a Vite plugin with 1,200 weekly downloads', roleId: null, skills: ['vite'], confirmed: false },
  ],
  languages: ['English', 'Hindi'],
});

test('newId is the prefix and 8 base36 characters, and unique', () => {
  const ids = new Set(Array.from({ length: 200 }, () => newId('f')));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.ok(isId(id, 'f'), id);
  assert.match(newId('r'), /^r_[0-9a-z]{8}$/);
  assert.equal(isId('f_ABCDEFGH', 'f'), false);
  assert.equal(isId('r_abcdefgh', 'f'), false);
});

test('an empty profile is valid', () => {
  assert.deepEqual(validateProfile(emptyProfile()), emptyProfile());
});

test('a realistic profile validates, with skill names made canonical', () => {
  const valid = validateProfile(profile());
  assert.ok(valid);
  assert.equal(valid.skills[0].name, 'react');
  assert.equal(valid.skills[0].label, 'React');
});

test('validation is strict', () => {
  const broken: Array<[string, (p: CareerProfile) => unknown]> = [
    ['month 13', (p) => ({ ...p, roles: [{ ...p.roles[0], start: '2021-13' }, p.roles[1]] })],
    ['end before start', (p) => ({ ...p, roles: [{ ...p.roles[0], end: '2020-01' }, p.roles[1]] })],
    ['year-only role date', (p) => ({ ...p, roles: [{ ...p.roles[0], start: '2021' }, p.roles[1]] })],
    ['dangling role id', (p) => ({ ...p, facts: [{ ...p.facts[0], roleId: 'r_nowhere1' }] })],
    ['dangling project fact', (p) => ({ ...p, projects: [{ ...p.projects[0], factIds: ['f_nowhere1'] }] })],
    ['duplicate id', (p) => ({ ...p, facts: [p.facts[0], { ...p.facts[1], id: p.facts[0].id }] })],
    ['bad id shape', (p) => ({ ...p, facts: [{ ...p.facts[0], id: 'fact-1' }] })],
    ['bad email', (p) => ({ ...p, contact: { ...p.contact, email: 'aarav at gmail' } })],
    ['too long', (p) => ({ ...p, headline: 'x'.repeat(201) })],
    ['too many facts', (p) => ({ ...p, projects: [], facts: Array.from({ length: 401 }, () => ({ ...p.facts[3], id: newId('f') })) })],
    ['fractional years', (p) => ({ ...p, skills: [{ name: 'react', label: 'React', years: 2.5 }] })],
    ['missing list', (p) => ({ ...p, languages: undefined })],
    ['confirmed not boolean', (p) => ({ ...p, facts: [{ ...p.facts[0], confirmed: 'yes' }] })],
  ];
  for (const [name, breakIt] of broken) assert.equal(validateProfile(breakIt(profile())), null, name);
  assert.equal(validateProfile(null), null);
  assert.equal(validateProfile('profile'), null);
});

test('years per skill count overlapping roles once', () => {
  const p = profile();
  // React at both employers: Infosys 2019-07..2022-03 and Razorpay 2021-11..now overlap by 5 months.
  p.facts.push({ id: 'f_reactinf', text: 'Built React widgets for the client portal', roleId: 'r_infosys1', skills: ['React'], confirmed: false });
  const years = deriveSkillYears(p, TODAY);
  // 2019-07 .. 2026-10 inclusive = 88 months.
  assert.equal(years.react, 7.3);
  // Razorpay alone: 2021-11 .. 2026-10 = 60 months.
  assert.equal(years.typescript, 5);
  assert.equal(years.angular, 2.8);
  // Only a role-less fact backs Vite: no dated span.
  assert.equal(years.vite, undefined);
  assert.equal(totalYears(p, TODAY), 7.3);
});

test('a role whose title names a skill counts its span', () => {
  const p = { ...emptyProfile(), roles: [{ id: 'r_reactdev', title: 'React Developer', employer: 'Bolt', location: null, start: '2024-01', end: '2024-12' }] };
  assert.deepEqual(deriveSkillYears(p, TODAY), { react: 1 });
});

test('coveredMonths merges overlaps and gaps correctly', () => {
  assert.equal(coveredMonths([[0, 12], [6, 18], [30, 36]]), 24);
  assert.equal(coveredMonths([]), 0);
});

// ─── Merge ──────────────────────────────────────────────────────────────

/** What a re-parse of an updated resume looks like: fresh ids for everything. */
const reparsed = (): CareerProfile => ({
  contact: { name: 'Aarav S.', email: 'aarav.new@gmail.com', phone: '+91 98765 43210', location: 'Bengaluru', links: [{ label: 'Portfolio', url: 'https://aarav.dev' }, { label: 'GitHub', url: 'https://GitHub.com/aaravs' }] },
  headline: 'Senior Frontend Engineer',
  summary: 'Frontend engineer with 7 years of experience.',
  roles: [
    { id: 'r_newrzp01', title: 'Frontend Engineer', employer: 'Razorpay Software Pvt Ltd', location: 'Bengaluru', start: '2021-11', end: null },
    { id: 'r_newinf01', title: 'Systems Engineer', employer: 'Infosys', location: null, start: '2019-07', end: '2022-03' },
    { id: 'r_newcnt01', title: 'Frontend Intern', employer: 'Zeta', location: null, start: '2019-01', end: '2019-06' },
  ],
  education: [{ id: 'e_newvit01', institution: 'VIT Vellore', degree: 'B.Tech', field: 'CSE', end: '2019', grade: null }],
  certifications: [{ id: 'c_newcka01', name: 'Certified Kubernetes Application Developer', issuer: 'CNCF', year: '2025' }],
  projects: [{ id: 'p_newvit01', name: 'vite-plugin-budget', url: null, factIds: ['f_newvit01'] }],
  skills: [{ name: 'react', label: 'React', years: 6 }, { name: 'kubernetes', label: 'Kubernetes', years: null }],
  facts: [
    // The same claim, reworded only in spacing and case: keeps the existing id.
    { id: 'f_newdsg01', text: 'Led the Design System used by 6 product teams.', roleId: 'r_newrzp01', skills: ['storybook'], confirmed: false },
    { id: 'f_newvit01', text: 'Published a Vite plugin with 1,200 weekly downloads', roleId: null, skills: ['vite'], confirmed: false },
    { id: 'f_newint01', text: 'Built an onboarding flow in React during the internship', roleId: 'r_newcnt01', skills: ['react'], confirmed: false },
  ],
  languages: ['english', 'Kannada'],
});

test('merge keeps the owner’s contact edits and fills only what is empty', () => {
  const existing = { ...profile(), contact: { ...profile().contact, phone: null } };
  const merged = mergeProfiles(existing, reparsed());
  assert.equal(merged.contact.name, 'Aarav Sharma');
  assert.equal(merged.contact.email, 'aarav.sharma@gmail.com');
  assert.equal(merged.contact.phone, '+91 98765 43210');
  assert.deepEqual(merged.contact.links.map((link) => link.label), ['GitHub', 'Portfolio']);
  assert.equal(merged.headline, 'Frontend Engineer');
  assert.equal(merged.summary, 'Frontend engineer with 7 years of experience.');
});

test('merge matches roles on employer + title + start and never drops one', () => {
  const merged = mergeProfiles(profile(), reparsed());
  assert.deepEqual(merged.roles.map((role) => role.id).slice(0, 2), ['r_razorpay', 'r_infosys1']);
  assert.equal(merged.roles.length, 3);
  assert.equal(merged.roles[2].employer, 'Zeta');
});

test('merge never drops or changes a confirmed fact, and drops unconfirmed ones the resume no longer says', () => {
  const merged = mergeProfiles(profile(), reparsed());
  const byId = new Map(merged.facts.map((fact) => [fact.id, fact]));
  assert.deepEqual(byId.get('f_checkout'), profile().facts[0]);
  // The Angular fact was unconfirmed and is gone from the new resume.
  assert.equal(byId.has('f_angular1'), false);
  // Repeated facts keep their ids; skills union.
  assert.deepEqual(byId.get('f_designsy')?.skills, ['design systems', 'storybook']);
  assert.ok(byId.has('f_vitepl01'));
  assert.equal(byId.has('f_newvit01'), false);
  // The new fact is linked to the new role.
  const internship = merged.facts.find((fact) => fact.text.includes('internship'));
  assert.equal(internship?.roleId, merged.roles[2].id);
  assert.ok(validateProfile(merged), 'merged profile validates');
});

test('merge unions skills with the larger years, and the other lists by name', () => {
  const merged = mergeProfiles(validateProfile(profile()) as CareerProfile, reparsed());
  assert.deepEqual(merged.skills.map((skill) => [skill.name, skill.years]), [['react', 6], ['typescript', null], ['kubernetes', null]]);
  assert.equal(merged.education.length, 1);
  assert.equal(merged.education[0].id, 'e_vitvelor');
  assert.equal(merged.certifications.length, 2);
  assert.deepEqual(merged.projects[0].factIds, ['f_vitepl01']);
  assert.equal(merged.projects[0].url, 'https://github.com/aaravs/vite-plugin-budget');
  assert.deepEqual(merged.languages, ['English', 'Hindi', 'Kannada']);
});

test('merge closes a current role when the new resume shows it ended', () => {
  const next = reparsed();
  next.roles[0] = { ...next.roles[0], end: '2026-09' };
  assert.equal(mergeProfiles(profile(), next).roles[0].end, '2026-09');
});

test('merge into an empty profile takes everything', () => {
  const merged = mergeProfiles(emptyProfile(), reparsed());
  assert.equal(merged.roles.length, 3);
  assert.equal(merged.facts.length, 3);
  assert.equal(merged.contact.name, 'Aarav S.');
  assert.ok(validateProfile(merged));
});

test('merge does not mutate its inputs', () => {
  const existing = profile();
  const incoming = reparsed();
  const before = JSON.stringify([existing, incoming]);
  mergeProfiles(existing, incoming);
  assert.equal(JSON.stringify([existing, incoming]), before);
});
