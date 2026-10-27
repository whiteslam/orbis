import { test } from 'vitest';
import assert from 'node:assert/strict';
import { applyEmailFor, applyRouteFor, betterAttempt, draftBlocker, nextFileVersion } from './draft-plan.ts';

test('email wins when there is an address, then Recruitee, then the link', () => {
  assert.equal(applyRouteFor({ applyEmail: 'jobs@acme.io', recruitee: { company: 'acme', offer: 'fe' } }, null), 'email');
  assert.equal(applyRouteFor({ applyEmail: null, recruitee: undefined }, { applyEmail: 'hr@acme.io' }), 'email');
  assert.equal(applyRouteFor({ applyEmail: null, recruitee: { company: 'acme', offer: 'fe' } }, null), 'recruitee');
  assert.equal(applyRouteFor({ applyEmail: null, recruitee: undefined }, { applyEmail: null }), 'link');
  assert.equal(applyEmailFor({ applyEmail: null }, { applyEmail: 'hr@acme.io' }), 'hr@acme.io');
});

test('file versions count up from the stored path', () => {
  assert.equal(nextFileVersion(null), 1);
  assert.equal(nextFileVersion('u/applications/a/resume-1.pdf'), 2);
  assert.equal(nextFileVersion('u/applications/a/resume-12.docx'), 13);
  assert.equal(nextFileVersion('u/other.pdf'), 1);
});

test('thin listings and sent applications are not drafted', () => {
  assert.match(draftBlocker({ thin: true, description: 'x' }, null) ?? '', /Paste the full job description/);
  assert.match(draftBlocker({ thin: false, description: '  ' }, null) ?? '', /Paste the full job description/);
  assert.match(draftBlocker({ thin: false, description: 'Full text' }, { status: 'sent' }) ?? '', /already has an application/);
  assert.equal(draftBlocker({ thin: false, description: 'Full text' }, { status: 'failed' }), null);
  assert.equal(draftBlocker({ thin: false, description: 'Full text' }, null), null);
});

test('the attempt that lost fewer bullets is kept', () => {
  assert.equal(betterAttempt({ failedShare: 0.5, id: 1 }, { failedShare: 0.2, id: 2 }).id, 2);
  assert.equal(betterAttempt({ failedShare: 0.4, id: 1 }, { failedShare: 0.4, id: 2 }).id, 1);
  assert.equal(betterAttempt({ failedShare: 0.4, id: 1 }, null).id, 1);
});
