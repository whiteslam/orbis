import { test } from 'vitest';
import assert from 'node:assert/strict';
import { checkTailored, hasPhrase, namedOrganisations, phraseIndex, quantities, type TruthInput } from './truth.ts';
import { sampleDraft, sampleProfile, sampleRequirements } from './render/fixtures.ts';
import type { CitedText } from './types.ts';

const values = (text: string) => quantities(text).map((quantity) => quantity.value);

const input = (over: Partial<TruthInput> = {}): TruthInput => ({
  draft: sampleDraft(),
  coverNote: { text: 'I would love to build payments at Stripe. At Acme Payments I cut checkout latency from 900 ms to 250 ms.', factIds: ['f_acme0001'] },
  answers: [{ question: 'Why Stripe?', answer: 'I have spent my time at Acme Payments on checkout, which is the heart of Stripe.' }],
  outreach: 'Hi! I lead frontend work at Acme Payments and cut checkout latency from 900 ms to 250 ms.',
  profile: sampleProfile(),
  requirements: sampleRequirements(),
  job: { company: 'Stripe', title: 'Senior Frontend Engineer' },
  ...over,
});

/** The sample draft with one more bullet under the Acme role. */
const withAcmeBullet = (bullet: CitedText) => {
  const draft = sampleDraft();
  draft.roles[0].bullets.push(bullet);
  return draft;
};

// ─── Numbers ─────────────────────────────────────────────────────────────

test('numbers read the same however they are written', () => {
  assert.deepEqual(values('₹1,20,000 and Rs. 1.2 L'), [120_000, 120_000]);
  assert.deepEqual(values('2.5M users, 2,500,000 users, 2.5 million'), [2_500_000, 2_500_000, 2_500_000]);
  assert.deepEqual(values('₹1.2 Cr = 1,20,00,000'), [12_000_000, 12_000_000]);
  assert.deepEqual(values('40% faster, 3x throughput, 10k req/s'), [40, 3, 10_000]);
  assert.deepEqual(values('₹30 LPA'), [3_000_000]);
});

test('names with digits in them are not numbers', () => {
  assert.deepEqual(values('p95 latency on EC2 and S3 with K8s, 3D maps, 2FA'), []);
  assert.deepEqual(values('ranked 1st, cut 900 ms'), [1, 900]);
});

test('every true bullet survives, with Indian and suffixed number formats matched', () => {
  const result = checkTailored(input());
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.draft, sampleDraft());
  assert.equal(result.failedShare, 0);
  assert.ok(result.coverNote.text.includes('900 ms to 250 ms'));
  assert.equal(result.answers.length, 1);
  assert.ok(result.outreach.includes('Acme Payments'));
});

test('an invented number is removed and listed', () => {
  const result = checkTailored(input({ draft: withAcmeBullet({ text: 'Cut checkout latency by 72%', factIds: ['f_acme0001'] }) }));
  assert.equal(result.removed.length, 1);
  assert.equal(result.removed[0].where, 'Senior Frontend Engineer');
  assert.match(result.removed[0].reason, /72%/);
  assert.equal(result.draft.roles[0].bullets.length, 3);
  assert.equal(result.failedShare, 1 / 6);
});

test('a number from a fact the bullet does not cite is still invented', () => {
  const result = checkTailored(input({ draft: withAcmeBullet({ text: 'Served 2.5M users with a 250 ms checkout', factIds: ['f_acme0001'] }) }));
  assert.equal(result.removed.length, 1);
  assert.match(result.removed[0].reason, /2\.5M/);
});

test('unknown fact ids, no citations and facts from another role are removed', () => {
  const draft = sampleDraft();
  draft.roles[0].bullets.push(
    { text: 'Shipped a new checkout', factIds: ['f_nope0000'] },
    { text: 'Shipped a new checkout', factIds: [] },
    { text: 'Built a GraphQL client layer', factIds: ['f_bolt0001'] },
  );
  const result = checkTailored(input({ draft }));
  assert.deepEqual(result.removed.map((item) => item.reason), [
    "it cites f_nope0000, which doesn't exist",
    'it cites no fact',
    'it cites f_bolt0001, which belongs to another role',
  ]);
});

// ─── Skills and names ────────────────────────────────────────────────────

test('skills the profile lacks are removed from the list and from bullets', () => {
  const draft = withAcmeBullet({ text: 'Led 4 engineers rebuilding the dashboard on Kubernetes', factIds: ['f_acme0002'] });
  draft.skills = ['ReactJS', 'kubernetes', 'TypeScript', 'react'];
  const result = checkTailored(input({ draft }));
  assert.deepEqual(result.draft.skills, ['react', 'typescript']);
  assert.deepEqual(result.removed.map((item) => item.where), ['skills', 'Senior Frontend Engineer']);
  assert.match(result.removed[1].reason, /kubernetes/i);
});

test('a skill from the general vocabulary that nothing backs is removed', () => {
  const result = checkTailored(input({ draft: withAcmeBullet({ text: 'Rebuilt the merchant dashboard in Vue', factIds: ['f_acme0002'] }) }));
  assert.equal(result.removed.length, 1);
  assert.match(result.removed[0].reason, /vue/);
});

test('organisations that are not in the profile are removed; the job\'s company is fine', () => {
  assert.deepEqual(namedOrganisations('Worked with Google and joined Goldman Sachs, then at the bank'), ['Google', 'Goldman Sachs']);
  const draft = withAcmeBullet({ text: 'Led 4 engineers for Flipkart on the merchant dashboard', factIds: ['f_acme0002'] });
  const result = checkTailored(input({
    draft,
    coverNote: { text: 'I want to join Stripe. Before Acme Payments I consulted for Infosys.', factIds: [] },
  }));
  assert.deepEqual(result.removed.map((item) => item.text), ['Led 4 engineers for Flipkart on the merchant dashboard', 'Before Acme Payments I consulted for Infosys.']);
  assert.equal(result.coverNote.text, 'I want to join Stripe.');
});

test('prose keeps its paragraph breaks, even around a removed sentence', () => {
  const text = 'I want to join Stripe.\n\nBefore Acme Payments I consulted for Infosys. At Acme Payments I cut checkout latency from 900 ms to 250 ms.\n\nThank you.';
  const result = checkTailored(input({ coverNote: { text, factIds: ['f_acme0001'] } }));
  assert.equal(result.coverNote.text, 'I want to join Stripe.\n\nAt Acme Payments I cut checkout latency from 900 ms to 250 ms.\n\nThank you.');
});

test('known names pass: employers, skills, schools, teams', () => {
  const result = checkTailored(input({
    outreach: 'I work with Product and Design at Acme Payments, with React and Next.js, and studied at Anna University.',
  }));
  assert.deepEqual(result.removed, []);
});

test('degrees and certifications the profile lacks are removed', () => {
  const result = checkTailored(input({
    answers: [
      { question: 'Education?', answer: 'I hold an MBA.' },
      { question: 'Degree?', answer: 'B.Tech in Computer Science.' },
      { question: 'Certs?', answer: 'I am a Google Certified Professional Cloud Architect.' },
      { question: 'AWS?', answer: 'I am AWS Certified Developer.' },
    ],
  }));
  assert.deepEqual(result.answers.map((answer) => answer.question), ['Degree?', 'AWS?']);
  assert.equal(result.removed.length, 2);
});

test('the headline and summary are checked too', () => {
  const draft = sampleDraft();
  draft.headline = 'Frontend lead who scaled Uber to 10M riders';
  draft.summary = { text: 'Frontend engineer who cut checkout latency from 900 ms to 250 ms. Grew revenue 3x.', factIds: ['f_acme0001', 'f_ghost000'] };
  const result = checkTailored(input({ draft }));
  assert.equal(result.draft.headline, '');
  assert.deepEqual(result.draft.summary, { text: 'Frontend engineer who cut checkout latency from 900 ms to 250 ms.', factIds: ['f_acme0001'] });
});

// ─── Owner edits and the failure share ───────────────────────────────────

test('text the owner typed stays, highlighted', () => {
  const typed = 'Cut checkout latency by 72% in one quarter';
  const result = checkTailored(input({ draft: withAcmeBullet({ text: typed, factIds: ['f_acme0001'] }), ownerEdits: [typed] }));
  assert.deepEqual(result.removed, []);
  assert.equal(result.highlights.length, 1);
  assert.equal(result.highlights[0].text, typed);
  assert.equal(result.draft.roles[0].bullets.length, 4);
});

test('failedShare is removed bullets over all bullets', () => {
  const draft = sampleDraft();
  for (const role of draft.roles) for (const bullet of role.bullets) bullet.text += ' for 99 clients';
  const result = checkTailored(input({ draft }));
  assert.equal(result.failedShare, 4 / 5);
});

test('phrases match whole words only', () => {
  const index = phraseIndex('JavaScript, Node.js and C++.');
  assert.ok(hasPhrase(index, 'node.js'));
  assert.ok(hasPhrase(index, 'C++'));
  assert.ok(!hasPhrase(index, 'Java'));
});
