import { test } from 'vitest';
import assert from 'node:assert/strict';
import { patchedContent, redraftText, type RedraftInput } from './redraft.ts';
import { sampleDraft, sampleProfile, sampleRequirements } from './render/fixtures.ts';

const application = (): RedraftInput['application'] => ({
  draft: sampleDraft(),
  coverNote: { text: 'I cut checkout latency from 900 ms to 250 ms at Acme Payments.', factIds: ['f_acme0001'] },
  answers: [{ question: 'Notice period', answer: '30 days' }],
  outreach: 'Hello, I applied for the frontend role.',
  removed: [{ where: 'skills', text: 'Kubernetes', reason: 'Kubernetes isn’t in your profile' }],
});
const job = { company: 'Stripe', title: 'Senior Frontend Engineer' };

test('only changed text counts as an owner edit, and reworded bullets keep their facts', () => {
  const patched = patchedContent(application(), {
    roleBullets: {
      roleId: 'r_acme0001',
      bullets: [
        'Cut checkout p95 latency from 900 ms to 250 ms by rendering at the edge',
        'Led a team of 4 engineers on the merchant dashboard rebuild',
        '   ',
      ],
    },
  });
  assert.deepEqual(patched.ownerEdits, ['Led a team of 4 engineers on the merchant dashboard rebuild']);
  const acme = patched.draft.roles.find((role) => role.roleId === 'r_acme0001');
  assert.deepEqual(acme?.bullets.map((bullet) => bullet.factIds), [['f_acme0001'], ['f_acme0002']]);
});

test('a number the owner types is kept but highlighted', () => {
  const result = redraftText({
    application: application(),
    patch: { coverNote: 'I cut checkout latency from 900 ms to 250 ms and grew revenue 40% at Acme Payments.' },
    profile: sampleProfile(),
    requirements: sampleRequirements(),
    job,
  });
  assert.match(result.coverNote.text, /40%/);
  assert.equal(result.highlights.length, 1);
  assert.match(result.highlights[0].text, /40%/);
  // The first check's removals are still listed, and the spec's own answers are not re-judged.
  assert.deepEqual(result.removed.map((item) => item.text), ['Kubernetes']);
  assert.deepEqual(result.answers, [{ question: 'Notice period', answer: '30 days' }]);
});

test('answers the owner changed are theirs; untouched ones are not edits', () => {
  const patched = patchedContent(application(), { answers: [{ question: 'Notice period', answer: '30 days' }, { question: 'Why us?', answer: 'Your payments work.' }] });
  assert.deepEqual(patched.ownerEdits, ['Your payments work.']);
});

test('a summary edit keeps the summary’s citations', () => {
  const patched = patchedContent(application(), { summary: 'Frontend engineer who made checkout fast.' });
  assert.deepEqual(patched.draft.summary, { text: 'Frontend engineer who made checkout fast.', factIds: ['f_acme0001'] });
  assert.deepEqual(patched.ownerEdits, ['Frontend engineer who made checkout fast.']);
});
