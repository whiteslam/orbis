import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { CareerProfile } from './types.ts';
import { buildSpecPrompt, emptySpec, parseMoney, parseSpecReply, validateSpec } from './spec.ts';
import { emptyProfile } from './profile.ts';

test('parseMoney reads Indian units', () => {
  assert.deepEqual(parseMoney('30 LPA'), { amount: 3_000_000, currency: 'INR', period: 'year' });
  assert.deepEqual(parseMoney('30 lakh'), { amount: 3_000_000, currency: 'INR', period: 'year' });
  assert.deepEqual(parseMoney('30L'), { amount: 3_000_000, currency: 'INR', period: 'year' });
  assert.deepEqual(parseMoney('1.2 crore'), { amount: 12_000_000, currency: 'INR', period: 'year' });
  assert.deepEqual(parseMoney('₹25,00,000'), { amount: 2_500_000, currency: 'INR', period: 'year' });
  assert.deepEqual(parseMoney('INR 18,00,000 per annum'), { amount: 1_800_000, currency: 'INR', period: 'year' });
  assert.deepEqual(parseMoney('Rs. 80,000 per month'), { amount: 80_000, currency: 'INR', period: 'month' });
});

test('parseMoney reads k suffixes, codes and symbols', () => {
  assert.deepEqual(parseMoney('$120k'), { amount: 120_000, currency: 'USD', period: 'year' });
  assert.deepEqual(parseMoney('120k USD'), { amount: 120_000, currency: 'USD', period: 'year' });
  assert.deepEqual(parseMoney('£65,000'), { amount: 65_000, currency: 'GBP', period: 'year' });
  assert.deepEqual(parseMoney('C$140k'), { amount: 140_000, currency: 'CAD', period: 'year' });
  assert.deepEqual(parseMoney('$1.5m'), { amount: 1_500_000, currency: 'USD', period: 'year' });
});

test('parseMoney reads periods', () => {
  assert.deepEqual(parseMoney('8000 per month'), { amount: 8000, currency: 'INR', period: 'month' });
  assert.deepEqual(parseMoney('€50/h'), { amount: 50, currency: 'EUR', period: 'hour' });
  assert.deepEqual(parseMoney('$45 hourly'), { amount: 45, currency: 'USD', period: 'hour' });
  assert.deepEqual(parseMoney('$5000/m'), { amount: 5000, currency: 'USD', period: 'month' });
  assert.deepEqual(parseMoney('90k EUR/yr'), { amount: 90_000, currency: 'EUR', period: 'year' });
});

test('parseMoney takes the lower end of a range, the unit after the second number', () => {
  assert.deepEqual(parseMoney('25-30 LPA'), { amount: 2_500_000, currency: 'INR', period: 'year' });
  assert.deepEqual(parseMoney('$100k – $130k'), { amount: 100_000, currency: 'USD', period: 'year' });
});

test('parseMoney falls back on the given currency and returns null without a number', () => {
  assert.deepEqual(parseMoney('50k', 'USD'), { amount: 50_000, currency: 'USD', period: 'year' });
  assert.equal(parseMoney('competitive'), null);
  assert.equal(parseMoney('0 LPA'), null);
});

test('validateSpec accepts an empty spec and a full one, canonicalising terms', () => {
  assert.deepEqual(validateSpec(emptySpec()), emptySpec());
  const spec = validateSpec({
    ...emptySpec(), roles: ['Frontend Engineer'], seniority: ['senior'], workModes: ['remote'], mustHaves: ['ReactJS', 'react'],
    dealBreakers: ['Crypto'], salaryFloor: { amount: 3_000_000, currency: 'INR', period: 'year' }, noticeDays: 30,
  });
  assert.deepEqual(spec?.mustHaves, ['react']);
  assert.deepEqual(spec?.dealBreakers, ['crypto']);
});

test('validateSpec is strict', () => {
  const base = emptySpec();
  assert.equal(validateSpec({ ...base, seniority: ['ninja'] }), null);
  assert.equal(validateSpec({ ...base, workModes: ['moon'] }), null);
  assert.equal(validateSpec({ ...base, salaryFloor: { amount: 30, currency: 'rupees', period: 'year' } }), null);
  assert.equal(validateSpec({ ...base, salaryFloor: { amount: -1, currency: 'INR', period: 'year' } }), null);
  assert.equal(validateSpec({ ...base, roles: Array.from({ length: 11 }, (_, i) => `Role ${i}`) }), null);
  assert.equal(validateSpec({ ...base, noticeDays: 999 }), null);
  assert.equal(validateSpec({ ...base, roles: undefined }), null);
  assert.equal(validateSpec('spec'), null);
});

const profile: CareerProfile = {
  ...emptyProfile(),
  headline: 'Frontend Engineer',
  skills: [{ name: 'react', label: 'React', years: 5 }],
  roles: [{ id: 'r_razorpay', title: 'Frontend Engineer', employer: 'Razorpay', location: null, start: '2021-11', end: null }],
};

test('the spec prompt carries the sentence and a slim profile', () => {
  const prompt = buildSpecPrompt('remote senior React roles above 30 LPA, no crypto', profile);
  assert.ok(prompt.user.includes('above 30 LPA'));
  assert.ok(prompt.user.includes('"React"'));
  assert.ok(!prompt.user.includes('r_razorpay'));
  assert.ok(!buildSpecPrompt('remote roles').user.includes('profile'));
});

test('a reply for "remote senior React roles above 30 LPA, no crypto" becomes a spec', () => {
  const reply = JSON.stringify({
    roles: ['Senior React Developer', 'Frontend Engineer'], seniority: ['Senior'], workModes: ['Remote'], locations: [],
    timezones: ['Asia/Kolkata', 'IST'], salaryFloor: '30 LPA', salaryTarget: null, companyStages: [], mustHaves: ['React.js'],
    dealBreakers: ['Crypto'], noticeDays: 60, notes: null,
  });
  assert.deepEqual(parseSpecReply(reply), {
    roles: ['Senior React Developer', 'Frontend Engineer'], seniority: ['senior'], workModes: ['remote'], locations: [],
    timezones: ['Asia/Kolkata'], salaryFloor: { amount: 3_000_000, currency: 'INR', period: 'year' }, salaryTarget: null,
    companyStages: [], mustHaves: ['react'], dealBreakers: ['crypto'], noticeDays: 60, notes: null,
  });
});

test('a money object from the model is accepted too; junk is not', () => {
  const spec = parseSpecReply('{"roles":["SDE"],"salaryFloor":{"amount":120000,"currency":"USD","period":"year"},"workModes":["in-office","hybrid"]}');
  assert.deepEqual(spec?.salaryFloor, { amount: 120_000, currency: 'USD', period: 'year' });
  assert.deepEqual(spec?.workModes, ['onsite', 'hybrid']);
  assert.equal(parseSpecReply('{}'), null);
  assert.equal(parseSpecReply('no idea'), null);
});
