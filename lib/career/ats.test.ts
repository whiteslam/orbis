import { test } from 'vitest';
import assert from 'node:assert/strict';
import { atsCheck } from './ats.ts';
import { sampleProfile, sampleRequirements } from './render/fixtures.ts';

const TEXT = [
  'Priya Raman',
  'Senior Frontend Engineer, React and TypeScript',
  'priya.raman@example.com | +91 98765 43210 | Bengaluru, India',
  'Summary',
  'Frontend engineer who cut checkout latency.',
  'Skills',
  'React, TypeScript, GraphQL, Next.js',
  'Experience',
  'Senior Frontend Engineer Mar 2022 – Present',
  'Frontend Engineer Jul 2019 – Feb 2022',
  'Software Engineer Intern Jan 2018 – Jun 2018',
  'Education',
  'B.Tech, Computer Science 2019',
].join('\n');

const check = (text: string, pages = 1) => atsCheck({ text, pages, profile: sampleProfile(), requirements: sampleRequirements() });
const failed = (text: string, pages = 1) => check(text, pages).checks.filter((item) => !item.ok).map((item) => item.id);

test('a clean resume passes and reports what the job asks for that it lacks', () => {
  const report = check(TEXT);
  assert.equal(report.passed, true);
  assert.equal(report.pages, 1);
  assert.deepEqual(report.missingKeywords, ['Kubernetes']);
  assert.equal(report.keywordCoverage, 0.8);
  assert.deepEqual(report.checks.map((item) => item.id), ['email', 'name', 'headings', 'roles', 'pages', 'keywords']);
});

test('keywords match through aliases and profile labels', () => {
  const requirements = { ...sampleRequirements(), mustHave: [{ skill: 'ReactJS', years: null }, { skill: 'TS', years: null }], niceToHave: [] };
  const report = atsCheck({ text: TEXT, pages: 1, profile: sampleProfile(), requirements });
  assert.equal(report.keywordCoverage, 1);
  assert.deepEqual(report.missingKeywords, []);
});

test('a missing email fails', () => {
  assert.deepEqual(failed(TEXT.replace('priya.raman@example.com', 'email hidden')), ['email']);
});

test('headings must be whole lines, present and in order', () => {
  assert.deepEqual(failed(TEXT.replace('\nEducation\n', '\nStudies\n')), ['headings']);
  const swapped = TEXT.replace('Skills\nReact, TypeScript, GraphQL, Next.js\n', '').replace('Education\n', 'Education\nSkills\nReact, TypeScript, GraphQL, Next.js\n');
  assert.deepEqual(failed(swapped), ['headings']);
});

test('every role title must be readable, newest first', () => {
  assert.deepEqual(failed(TEXT.replace('Software Engineer Intern', 'Intern')), ['roles']);
  const senior = 'Senior Frontend Engineer Mar 2022 – Present';
  const intern = 'Software Engineer Intern Jan 2018 – Jun 2018';
  const reordered = TEXT.replace(`${senior}\n`, '').replace(intern, `${intern}\n${senior}`).replace('Senior Frontend Engineer, React', 'Headline');
  assert.deepEqual(failed(reordered), ['roles']);
  assert.match(check(reordered).checks.find((item) => item.id === 'roles')?.note ?? '', /out of order/);
});

test('more than two pages fails; low keyword coverage is flagged without failing', () => {
  assert.deepEqual(failed(TEXT, 3), ['pages']);
  const requirements = { ...sampleRequirements(), mustHave: [{ skill: 'Rust', years: null }, { skill: 'Go', years: null }], niceToHave: [] };
  const report = atsCheck({ text: TEXT, pages: 1, profile: sampleProfile(), requirements });
  assert.equal(report.passed, true);
  assert.equal(report.keywordCoverage, 0);
  assert.equal(report.checks.find((item) => item.id === 'keywords')?.ok, false);
});
