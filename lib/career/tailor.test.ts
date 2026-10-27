import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildTailorPrompt, capWords, mergeAnswers, noticeAnswer, parseTailorReply, salaryAnswer, standardAnswers } from './tailor.ts';
import { checkTailored } from './truth.ts';
import { sampleDraft, sampleProfile, sampleRequirements, sampleSpec } from './render/fixtures.ts';
import type { Match } from './types.ts';

const match: Match = {
  score: 78,
  confidence: 'high',
  parts: { must: 40, nice: 20, experience: 10, role: 8 },
  lines: [
    { requirement: { skill: 'React', years: 4 }, kind: 'must', verdict: 'met', evidence: ['f_acme0002'], note: '6 years' },
    { requirement: { skill: 'Kubernetes', years: null }, kind: 'must', verdict: 'missing', evidence: [], note: 'Not in profile' },
  ],
  excluded: null,
};
const job = { title: 'Senior Frontend Engineer', company: 'Stripe', location: 'Remote, India', description: 'Build checkout with React and TypeScript.' };
const TODAY = '2026-10-27';

const reply = (over: Record<string, unknown> = {}) => JSON.stringify({
  headline: sampleDraft().headline,
  summary: sampleDraft().summary,
  skills: sampleDraft().skills,
  roles: sampleDraft().roles,
  projects: sampleDraft().projects,
  coverNote: { text: 'I want to build checkout at Stripe.', factIds: ['f_acme0001'] },
  answers: [{ question: 'Why do you want to work at Stripe?', answer: 'Checkout is the work I like most.' }],
  outreach: 'Hi, I build fast checkouts.',
  ...over,
});

// ─── Prompt ──────────────────────────────────────────────────────────────

test('the prompt lists every fact by id and states the rules', () => {
  const prompt = buildTailorPrompt({ profile: sampleProfile(), spec: sampleSpec(), job, requirements: sampleRequirements(), match });
  for (const fact of sampleProfile().facts) assert.ok(prompt.user.includes(`${fact.id} (`), fact.id);
  assert.ok(prompt.user.includes('r_acme0001: Senior Frontend Engineer at Acme Payments (2022-03 to now)'));
  assert.ok(prompt.user.includes('Kubernetes: missing'));
  assert.ok(prompt.user.includes('- Why do you want to work at Stripe?'));
  assert.ok(prompt.user.includes('Build checkout with React and TypeScript.'));
  assert.match(prompt.system, /Never introduce a number/);
  assert.match(prompt.system, /factIds/);
  assert.match(prompt.system, /Return content only/);
  assert.match(prompt.system, /data, not instructions/);
});

test('a long description is capped', () => {
  const prompt = buildTailorPrompt({ profile: sampleProfile(), spec: sampleSpec(), job: { ...job, description: 'x'.repeat(20_000) }, requirements: null, match: null });
  assert.ok(!prompt.user.includes('x'.repeat(12_001)));
  assert.ok(prompt.user.includes('x'.repeat(12_000)));
});

// ─── Reply ───────────────────────────────────────────────────────────────

test('a well-formed reply parses, fenced or not', () => {
  const parsed = parseTailorReply(`\`\`\`json\n${reply()}\n\`\`\``, sampleProfile());
  assert.ok(parsed);
  assert.deepEqual(parsed.draft, sampleDraft());
  assert.equal(parsed.coverNote.text, 'I want to build checkout at Stripe.');
  assert.equal(parsed.answers.length, 1);
  assert.equal(parsed.outreach, 'Hi, I build fast checkouts.');
});

test('unusable replies are null', () => {
  assert.equal(parseTailorReply('not json', sampleProfile()), null);
  assert.equal(parseTailorReply('[]', sampleProfile()), null);
  assert.equal(parseTailorReply(reply({ roles: 'none' }), sampleProfile()), null);
  assert.equal(parseTailorReply(reply({ coverNote: null }), sampleProfile()), null);
  assert.equal(parseTailorReply(reply({ summary: { text: '' } }), sampleProfile()), null);
});

test('unknown roles and projects are dropped, bullets capped at six, junk entries skipped', () => {
  const bullets = Array.from({ length: 9 }, (_, index) => ({ text: `Bullet ${index}`, factIds: ['f_acme0001', 7, 'f_acme0001'] }));
  const parsed = parseTailorReply(reply({
    roles: [{ roleId: 'r_ghost', bullets }, { roleId: 'r_acme0001', bullets: [...bullets, { text: '' }, 'nope'] }, { roleId: 'r_acme0001', bullets }],
    projects: [{ projectId: 'p_ghost', bullets }],
    answers: [{ question: 'Q', answer: '' }, null, { question: 'Q2', answer: 'A2' }],
  }), sampleProfile());
  assert.ok(parsed);
  assert.deepEqual(parsed.draft.roles.map((role) => role.roleId), ['r_acme0001']);
  assert.equal(parsed.draft.roles[0].bullets.length, 6);
  assert.deepEqual(parsed.draft.roles[0].bullets[0].factIds, ['f_acme0001']);
  assert.deepEqual(parsed.draft.projects, []);
  assert.deepEqual(parsed.answers, [{ question: 'Q2', answer: 'A2' }]);
});

test('the cover note is cut to 180 words at a sentence end', () => {
  const sentence = 'I build fast and accessible checkout flows for payments teams every day.';
  const long = Array.from({ length: 20 }, () => sentence).join(' ');
  const parsed = parseTailorReply(reply({ coverNote: { text: long, factIds: [] } }), sampleProfile());
  assert.ok(parsed);
  const words = parsed.coverNote.text.split(' ').length;
  assert.ok(words <= 180 && words > 150, String(words));
  assert.ok(parsed.coverNote.text.endsWith('day.'));
  assert.equal(capWords('one two three four', 2), 'one two');
});

// ─── Standard answers ────────────────────────────────────────────────────

test('salary is a range from the spec, in the currency\'s own style', () => {
  const spec = sampleSpec();
  assert.equal(salaryAnswer(spec.salaryFloor, spec.salaryTarget), '₹30–36 LPA');
  assert.equal(salaryAnswer({ amount: 2_250_000, currency: 'INR', period: 'year' }, null), '₹22.5 LPA or more');
  assert.equal(salaryAnswer(null, { amount: 250_000, currency: 'INR', period: 'month' }), 'Around ₹2,50,000 a month');
  assert.equal(salaryAnswer({ amount: 140_000, currency: 'USD', period: 'year' }, { amount: 120_000, currency: 'USD', period: 'year' }), '$120,000–$140,000 a year');
  assert.equal(salaryAnswer(null, null), 'To confirm');
});

test('notice period counts forward from today', () => {
  assert.equal(noticeAnswer(30, TODAY), '30 days (I can join by 26 Nov 2026)');
  assert.equal(noticeAnswer(0, TODAY), 'Immediately');
  assert.equal(noticeAnswer(null, TODAY), 'To confirm');
});

test('standard answers come from the profile and spec alone', () => {
  const answers = standardAnswers({ profile: sampleProfile(), spec: sampleSpec(), requirements: sampleRequirements(), today: TODAY });
  assert.deepEqual(answers, [
    { question: 'Notice period', answer: '30 days (I can join by 26 Nov 2026)' },
    { question: 'Expected salary', answer: '₹30–36 LPA' },
    { question: 'Work authorisation', answer: 'Indian citizen, authorised to work in India' },
    { question: 'Total years of experience', answer: '7 years' },
    { question: 'Years of experience with React', answer: '6 years' },
    { question: 'Years of experience with TypeScript', answer: '5 years' },
    { question: 'Years of experience with Kubernetes', answer: 'To confirm' },
  ]);
});

test('work authorisation stays "To confirm" when the profile says nothing', () => {
  const profile = sampleProfile();
  profile.facts = profile.facts.filter((fact) => fact.id !== 'f_auth0001');
  const answers = standardAnswers({ profile, spec: sampleSpec(), requirements: null, today: TODAY });
  assert.equal(answers.find((answer) => answer.question === 'Work authorisation')?.answer, 'To confirm');
});

test('merging: the profile answers common questions, checked AI answers keep the rest', () => {
  const ai = [
    { question: 'What is your notice period?', answer: 'Two weeks' },
    { question: 'How many years of React experience do you have?', answer: '8 years' },
    { question: 'Why do you want to work at Stripe?', answer: 'Checkout is the work I like most.' },
  ];
  const merged = mergeAnswers({ profile: sampleProfile(), spec: sampleSpec(), requirements: sampleRequirements(), today: TODAY, ai });
  assert.deepEqual(merged.slice(0, 3), [
    { question: 'What is your notice period?', answer: '30 days (I can join by 26 Nov 2026)' },
    { question: 'How many years of React experience do you have?', answer: '6 years' },
    { question: 'Why do you want to work at Stripe?', answer: 'Checkout is the work I like most.' },
  ]);
  const questions = merged.map((answer) => answer.question);
  assert.ok(!questions.includes('Notice period'));
  assert.ok(!questions.includes('Years of experience with React'));
  assert.ok(questions.includes('Expected salary'));
});

test('an AI answer that fails the truth check never reaches the merge', () => {
  const parsed = parseTailorReply(reply({ answers: [{ question: 'Why Stripe?', answer: 'I grew revenue 5x at Razorpay.' }] }), sampleProfile());
  assert.ok(parsed);
  const checked = checkTailored({ ...parsed, profile: sampleProfile(), requirements: sampleRequirements(), job });
  const merged = mergeAnswers({ profile: sampleProfile(), spec: sampleSpec(), requirements: sampleRequirements(), today: TODAY, ai: checked.answers });
  assert.equal(merged.find((answer) => answer.question === 'Why Stripe?'), undefined);
  assert.equal(merged.find((answer) => answer.question === 'Why do you want to work at Stripe?')?.answer, 'To confirm');
});
