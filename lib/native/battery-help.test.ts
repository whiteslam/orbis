import { test } from 'vitest';
import assert from 'node:assert/strict';
import { batteryHelp } from './battery-help';

test('Xiaomi, Redmi and Poco share the Xiaomi steps, in any case', () => {
  const xiaomi = batteryHelp('XIAOMI');
  assert.equal(xiaomi.brand, 'Xiaomi');
  assert.deepEqual(batteryHelp('Redmi'), xiaomi);
  assert.deepEqual(batteryHelp('poco'), xiaomi);
  assert.deepEqual(batteryHelp(' Xiaomi '), xiaomi);
});

test('each family maps to its own brand', () => {
  assert.equal(batteryHelp('samsung').brand, 'Samsung');
  assert.equal(batteryHelp('OPPO').brand, 'Oppo');
  assert.deepEqual(batteryHelp('realme'), batteryHelp('Oppo'));
  assert.equal(batteryHelp('vivo').brand, 'Vivo');
  assert.deepEqual(batteryHelp('iQOO'), batteryHelp('vivo'));
  assert.equal(batteryHelp('OnePlus').brand, 'OnePlus');
});

test('Google, an unknown maker and an empty name get the default', () => {
  const fallback = batteryHelp('Google');
  assert.notEqual(fallback.brand, 'Xiaomi');
  assert.deepEqual(batteryHelp('Nothing'), fallback);
  assert.deepEqual(batteryHelp(''), fallback);
});

test('every brand has at least two steps', () => {
  for (const maker of ['Samsung', 'Xiaomi', 'Redmi', 'Poco', 'Oppo', 'Realme', 'Vivo', 'iQOO', 'OnePlus', 'Google']) {
    const { steps } = batteryHelp(maker);
    assert.ok(steps.length >= 2, maker);
    for (const step of steps) assert.ok(step.trim().length > 0, maker);
  }
});
