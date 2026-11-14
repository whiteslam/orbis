import { test } from 'vitest';
import assert from 'node:assert/strict';
import { formatMoney } from './money.ts';
import { money } from '../finance/money.ts';

test('formatMoney: auto decimals', () => {
  assert.equal(formatMoney(1234.5, 'INR', 'en-IN'), '₹1,235');
  assert.equal(formatMoney(12.5, 'USD', 'en-US'), '$12.50');
  assert.equal(formatMoney(999.5, 'INR', 'en-IN'), '₹999.50');
});

test('formatMoney: compact drops decimals and abbreviates', () => {
  assert.equal(formatMoney(1234567, 'INR', 'en-IN', { compact: true }), money(1234567, 'INR', true));
  assert.equal(formatMoney(12.5, 'USD', 'en-US', { compact: true }), '$13');
});

test('formatMoney: decimals 0 forces whole units', () => {
  assert.equal(formatMoney(12.5, 'USD', 'en-US', { decimals: 0 }), '$13');
  assert.equal(formatMoney(12.4, 'USD', 'en-US', { decimals: 0 }), '$12');
});

test('formatMoney: matches lib/finance/money.ts for en-IN', () => {
  for (const [amount, compact] of [[5, false], [999.99, false], [1000, false], [250000, true], [-45.5, false]] as const) {
    assert.equal(formatMoney(amount, 'INR', 'en-IN', { compact }), money(amount, 'INR', compact));
  }
});

test('formatMoney: invalid currency falls back to code and amount', () => {
  assert.equal(formatMoney(5, 'XYZ1', 'en-IN'), 'XYZ1 5');
});

test('formatMoney: exact decimals keep paise only when the amount has them', () => {
  assert.equal(formatMoney(1250.5, 'INR', 'en-IN', { decimals: 'exact' }), '₹1,250.50');
  assert.equal(formatMoney(1250, 'INR', 'en-IN', { decimals: 'exact' }), '₹1,250');
});
