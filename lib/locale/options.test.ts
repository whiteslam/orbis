import { test } from 'vitest';
import assert from 'node:assert/strict';
import { canonicalTimeZone, normalizeSettings } from './person.ts';
import { COMMON_CURRENCIES, currencyOptions, guessFromBrowser, timeZoneOptions } from './options.ts';

test('the browser zone prefills the zone; India gets INR, everyone else USD', () => {
  assert.deepEqual(guessFromBrowser('Asia/Kolkata'), { timeZone: 'Asia/Kolkata', currency: 'INR' });
  // Chrome and Node still report the old name.
  assert.deepEqual(guessFromBrowser('Asia/Calcutta'), { timeZone: 'Asia/Kolkata', currency: 'INR' });
  assert.deepEqual(guessFromBrowser('America/New_York'), { timeZone: 'America/New_York', currency: 'USD' });
});

test('no usable browser zone gives the India defaults', () => {
  assert.deepEqual(guessFromBrowser(undefined), { timeZone: 'Asia/Kolkata', currency: 'INR' });
  assert.deepEqual(guessFromBrowser('Nowhere/Land'), { timeZone: 'Asia/Kolkata', currency: 'INR' });
});

test('currencies: the common ones first, then the rest once each', () => {
  const list = currencyOptions();
  assert.deepEqual(COMMON_CURRENCIES, ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD']);
  assert.deepEqual(list.slice(0, COMMON_CURRENCIES.length), COMMON_CURRENCIES);
  assert.equal(new Set(list).size, list.length);
  assert.ok(list.includes('JPY'));
});

test('time zones: include the current one and UTC, use Asia/Kolkata not Asia/Calcutta, sorted, once each', () => {
  const list = timeZoneOptions('Etc/GMT+5');
  assert.ok(list.includes('Etc/GMT+5'));
  assert.ok(list.includes('UTC'));
  assert.ok(list.includes('Asia/Kolkata'));
  assert.ok(!list.includes('Asia/Calcutta'));
  assert.equal(new Set(list).size, list.length);
  assert.deepEqual(list, [...list].sort());
});

test('the zone settings read back from an aliased row is always one of the options', () => {
  const zone = normalizeSettings({ timezone: 'Asia/Calcutta' }).timeZone;
  assert.ok(timeZoneOptions(zone).includes(zone));
  assert.ok(timeZoneOptions('Asia/Calcutta').includes(canonicalTimeZone('Asia/Calcutta')));
});
