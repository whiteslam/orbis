import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ALL_MODULES, canonicalTimeZone, DEFAULT_PERSON_LOCALE, isValidCurrency, isValidLocale, isValidTimeZone, normalizeSettings, ONBOARDED_UNKNOWN, settingsFromRead, zoneForPerson } from './person.ts';

test('a missing row gives the India defaults, every module, and not onboarded', () => {
  assert.deepEqual(normalizeSettings(null), { ...DEFAULT_PERSON_LOCALE, modules: ALL_MODULES, onboardedAt: null });
  assert.deepEqual(DEFAULT_PERSON_LOCALE, { timeZone: 'Asia/Kolkata', currency: 'INR', locale: 'en-IN' });
  assert.deepEqual(ALL_MODULES, ['money', 'health', 'journal', 'social', 'career']);
});

test('bad values fall back to the defaults and unknown modules are dropped', () => {
  const settings = normalizeSettings({
    timezone: 'Mars/Base',
    currency: 'XYZ1',
    locale: '',
    modules: ['money', 'bogus'],
    onboarded_at: '2026-11-12T00:00:00Z',
  });
  assert.equal(settings.timeZone, 'Asia/Kolkata');
  assert.equal(settings.currency, 'INR');
  assert.equal(settings.locale, 'en-IN');
  assert.deepEqual(settings.modules, ['money']);
  assert.equal(settings.onboardedAt, '2026-11-12T00:00:00Z');
});

test('good values are kept', () => {
  const settings = normalizeSettings({ timezone: 'America/Los_Angeles', currency: 'USD', locale: 'en-US', modules: ['journal', 'money'], onboarded_at: null });
  assert.equal(settings.timeZone, 'America/Los_Angeles');
  assert.equal(settings.currency, 'USD');
  assert.equal(settings.locale, 'en-US');
  assert.deepEqual(settings.modules, ['journal', 'money']);
  assert.equal(settings.onboardedAt, null);
});

test('time zones, currencies and locales are checked', () => {
  assert.equal(isValidTimeZone('America/Los_Angeles'), true);
  assert.equal(isValidTimeZone('Mars/Base'), false);
  assert.equal(isValidTimeZone(''), false);
  assert.equal(isValidCurrency('USD'), true);
  assert.equal(isValidCurrency('usd'), false);
  assert.equal(isValidCurrency('XYZ1'), false);
  assert.equal(isValidCurrency('XYZ'), false);
  assert.equal(normalizeSettings({ currency: 'XYZ' }).currency, 'INR');
  assert.equal(isValidLocale('en-IN'), true);
  assert.equal(isValidLocale(''), false);
  assert.equal(isValidLocale('not a locale'), false);
});

test('a failed read counts as onboarded; only a good read with no row does not', () => {
  assert.deepEqual(settingsFromRead(null, true), { ...DEFAULT_PERSON_LOCALE, modules: ALL_MODULES, onboardedAt: ONBOARDED_UNKNOWN });
  assert.equal(settingsFromRead({ onboarded_at: '2026-11-12T00:00:00Z' }, true).onboardedAt, ONBOARDED_UNKNOWN);
  assert.equal(settingsFromRead(null, false).onboardedAt, null);
  const row = settingsFromRead({ timezone: 'America/Los_Angeles', onboarded_at: '2026-11-12T00:00:00Z' }, false);
  assert.equal(row.timeZone, 'America/Los_Angeles');
  assert.equal(row.onboardedAt, '2026-11-12T00:00:00Z');
});

test('a legacy zone alias reads as the IANA name the pickers list', () => {
  assert.equal(normalizeSettings({ timezone: 'Asia/Calcutta' }).timeZone, 'Asia/Kolkata');
  assert.equal(canonicalTimeZone('Asia/Calcutta'), 'Asia/Kolkata');
  assert.equal(canonicalTimeZone('Europe/London'), 'Europe/London');
});

test('the settings zone wins over the notification zone', () => {
  assert.equal(zoneForPerson('America/Los_Angeles', 'Asia/Kolkata'), 'America/Los_Angeles');
  assert.equal(zoneForPerson('Asia/Calcutta', 'Europe/London'), 'Asia/Kolkata');
});

test('the notification zone is used only when there is no readable settings zone', () => {
  assert.equal(zoneForPerson(null, 'Europe/London'), 'Europe/London');
  assert.equal(zoneForPerson(undefined, 'Europe/Kiev'), 'Europe/Kyiv');
  assert.equal(zoneForPerson('Mars/Base', 'Europe/London'), 'Europe/London');
});

test('with neither zone usable, the default', () => {
  assert.equal(zoneForPerson(null, null), DEFAULT_PERSON_LOCALE.timeZone);
  assert.equal(zoneForPerson(undefined, 'Nowhere/Real'), DEFAULT_PERSON_LOCALE.timeZone);
  assert.equal(zoneForPerson(null, 42), DEFAULT_PERSON_LOCALE.timeZone);
});
