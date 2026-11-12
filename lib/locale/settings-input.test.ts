import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseSettingsInput } from './settings-input.ts';

const good = { timeZone: 'Europe/London', currency: 'GBP', locale: 'en-GB', modules: ['money', 'health'] };

test('a good input passes through, modules in tab order', () => {
  assert.deepEqual(parseSettingsInput({ ...good, modules: ['health', 'money'] }), { ok: true, value: good });
});

test('locale is optional; left out, it is not set', () => {
  const rest = { timeZone: good.timeZone, currency: good.currency, modules: good.modules };
  assert.deepEqual(parseSettingsInput(rest), { ok: true, value: { ...rest, locale: undefined } });
});

test('a bad time zone says so', () => {
  assert.deepEqual(parseSettingsInput({ ...good, timeZone: 'Mars/Olympus' }), { ok: false, message: 'Pick a valid time zone.' });
  assert.deepEqual(parseSettingsInput({ ...good, timeZone: 42 }), { ok: false, message: 'Pick a valid time zone.' });
});

test('a bad currency says so', () => {
  assert.deepEqual(parseSettingsInput({ ...good, currency: 'XYZ' }), { ok: false, message: 'Pick a valid currency.' });
  assert.deepEqual(parseSettingsInput({ ...good, currency: 'inr' }), { ok: false, message: 'Pick a valid currency.' });
});

test('a bad language or module list says so', () => {
  assert.deepEqual(parseSettingsInput({ ...good, locale: 'not a locale!' }), { ok: false, message: 'Pick a valid language.' });
  assert.deepEqual(parseSettingsInput({ ...good, modules: ['money', 'bank'] }), { ok: false, message: 'Pick modules from the list.' });
});

test('anything that is not an object is rejected', () => {
  assert.equal(parseSettingsInput(null).ok, false);
  assert.equal(parseSettingsInput([]).ok, false);
});
