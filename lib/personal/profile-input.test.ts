import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parsePersonalProfile } from './profile-input.ts';

test('trims each detail', () => {
  assert.deepEqual(parsePersonalProfile({ preferredName: ' Asha ', role: '', aboutMe: ' x ' }), { ok: true, profile: { preferredName: 'Asha', role: '', aboutMe: 'x' } });
});

test('needs at least one detail', () => {
  assert.deepEqual(parsePersonalProfile({ preferredName: ' ', role: '', aboutMe: '' }), { ok: false, message: 'Add at least one detail before saving.' });
});

test('keeps the existing limits and wording', () => {
  assert.deepEqual(parsePersonalProfile({ preferredName: 'a'.repeat(81), role: '', aboutMe: '' }), { ok: false, message: 'Keep your preferred name under 80 characters.' });
  assert.deepEqual(parsePersonalProfile({ preferredName: 'a', role: 'r'.repeat(121), aboutMe: '' }), { ok: false, message: 'Keep your work or role under 120 characters.' });
  assert.deepEqual(parsePersonalProfile({ preferredName: 'a', role: '', aboutMe: 'm'.repeat(3001) }), { ok: false, message: 'Keep “More about me” under 3,000 characters.' });
});

test('rejects malformed input', () => {
  for (const bad of [null, [], 'Asha', { preferredName: 'Asha' }]) {
    assert.deepEqual(parsePersonalProfile(bad), { ok: false, message: 'Review your profile details and try again.' });
  }
});
