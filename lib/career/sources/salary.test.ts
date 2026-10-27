import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseSalaryText } from './salary.ts';

test('reads ranges with k and a currency mark', () => {
  assert.deepEqual(parseSalaryText('$170k to $230k Base + Equity'), { min: 170_000, max: 230_000, currency: 'USD', period: 'year' });
  assert.deepEqual(parseSalaryText('US$228k - US$285k'), { min: 228_000, max: 285_000, currency: 'USD', period: 'year' });
  assert.deepEqual(parseSalaryText('100k-160k GBP + 0.25-0.75% Equity'), { min: 100_000, max: 160_000, currency: 'GBP', period: 'year' });
});

test('uses the hinted currency when the text has none', () => {
  assert.deepEqual(parseSalaryText('70K-80K', { currency: 'USD' }), { min: 70_000, max: 80_000, currency: 'USD', period: 'year' });
  assert.equal(parseSalaryText('70K-80K'), null);
});

test('reads Indian lakhs and full figures with separators', () => {
  assert.deepEqual(parseSalaryText('10-20 Lacs PA'), { min: 1_000_000, max: 2_000_000, currency: 'INR', period: 'year' });
  assert.deepEqual(parseSalaryText('€50.000 – €65.000'), { min: 50_000, max: 65_000, currency: 'EUR', period: 'year' });
  assert.deepEqual(parseSalaryText('£45,000'), { min: 45_000, max: 45_000, currency: 'GBP', period: 'year' });
});

test('reads hourly and monthly pay, and open-ended figures', () => {
  assert.deepEqual(parseSalaryText('$60 - $80 per hour'), { min: 60, max: 80, currency: 'USD', period: 'hour' });
  assert.deepEqual(parseSalaryText('Up to $120k'), { min: null, max: 120_000, currency: 'USD', period: 'year' });
  assert.deepEqual(parseSalaryText('₹90,000 / month'), { min: 90_000, max: 90_000, currency: 'INR', period: 'month' });
});

test('refuses yearly figures too small to be pay, and text with no figure', () => {
  assert.equal(parseSalaryText('$100-120'), null);
  assert.equal(parseSalaryText('Competitive, USD'), null);
});
