import { test } from 'vitest';
import assert from 'node:assert/strict';
import { formatWhen, localDate, localParts, monthStartUtc, zoneOffset, zonedIso } from './dates.ts';
import { DEFAULT_PERSON_LOCALE } from './person.ts';

test('localDate follows the zone, not UTC', () => {
  assert.equal(localDate('2026-11-12T04:00:00Z', 'America/Los_Angeles'), '2026-11-11');
  assert.equal(localDate('2026-11-12T04:00:00Z', 'Asia/Kolkata'), '2026-11-12');
  assert.equal(localDate(new Date('2026-11-12T20:00:00Z'), 'Asia/Kolkata'), '2026-11-13');
});

test('localParts gives wall-clock parts with Monday as 0', () => {
  // 2026-11-12 is a Thursday; 09:35Z is 15:05 in Kolkata.
  assert.deepEqual(localParts('2026-11-12T09:35:00Z', 'Asia/Kolkata'), { year: 2026, month: 11, day: 12, hour: 15, minute: 5, weekday: 3 });
  // Sunday 2026-11-15 in Kolkata.
  assert.equal(localParts('2026-11-15T09:00:00Z', 'Asia/Kolkata').weekday, 6);
  assert.equal(localParts('2026-11-16T09:00:00Z', 'Asia/Kolkata').weekday, 0);
  // Midnight is hour 0, not 24.
  assert.equal(localParts('2026-11-12T18:30:00Z', 'Asia/Kolkata').hour, 0);
});

test('zoneOffset formats the offset for that instant', () => {
  assert.equal(zoneOffset(new Date('2026-11-12T00:00:00Z'), 'Asia/Kolkata'), '+05:30');
  assert.equal(zoneOffset(new Date('2026-07-01T00:00:00Z'), 'America/Los_Angeles'), '-07:00');
  assert.equal(zoneOffset(new Date('2026-11-12T00:00:00Z'), 'UTC'), 'Z');
  assert.equal(zoneOffset(new Date('2026-01-15T00:00:00Z'), 'Europe/London'), 'Z');
});

test('zonedIso puts the right offset on a local wall time', () => {
  assert.equal(zonedIso('2026-03-28', '12:00', 'Europe/London'), '2026-03-28T12:00:00Z');
  assert.equal(zonedIso('2026-03-30', '12:00', 'Europe/London'), '2026-03-30T12:00:00+01:00');
  assert.equal(zonedIso('2026-11-12', '09:30', 'Asia/Kolkata'), '2026-11-12T09:30:00+05:30');
  assert.equal(zonedIso('2026-11-12', '09:30:15', 'Asia/Kolkata'), '2026-11-12T09:30:15+05:30');
});

test('zonedIso round-trips through localParts across a DST change', () => {
  // London springs forward on 2026-03-29; 00:30 that day is still GMT, 12:00 is BST.
  assert.equal(zonedIso('2026-03-29', '00:30', 'Europe/London'), '2026-03-29T00:30:00Z');
  assert.equal(zonedIso('2026-03-29', '12:00', 'Europe/London'), '2026-03-29T12:00:00+01:00');
  const iso = zonedIso('2026-11-01', '09:00', 'America/Los_Angeles');
  assert.equal(iso, '2026-11-01T09:00:00-08:00');
  assert.equal(localParts(iso, 'America/Los_Angeles').hour, 9);
});

test('monthStartUtc is local midnight on the 1st as a UTC instant', () => {
  assert.equal(monthStartUtc(2026, 11, 'Asia/Kolkata'), '2026-10-31T18:30:00.000Z');
  assert.equal(monthStartUtc(2026, 4, 'Europe/London'), '2026-03-31T23:00:00.000Z');
});

test('formatWhen presets in the default locale', () => {
  const at = '2026-11-12T09:35:00Z'; // 15:05 in Kolkata
  const loc = DEFAULT_PERSON_LOCALE;
  assert.equal(formatWhen(at, loc, 'day'), '12 Nov');
  assert.equal(formatWhen(at, loc, 'dayLong'), 'Thursday, 12 November');
  assert.equal(formatWhen(at, loc, 'time'), '3:05 pm');
  assert.equal(formatWhen(at, loc, 'dayTime'), '12 Nov, 3:05 pm');
  assert.equal(formatWhen(at, loc, 'medium'), '12 Nov 2026');
  assert.equal(formatWhen(at, loc, 'weekday'), 'Thursday');
  assert.equal(formatWhen(at, loc, 'shortTime'), '3:05 pm');
  assert.equal(formatWhen(at, loc, 'weekdayDayTime'), 'Thu, 12 Nov, 3:05 pm');
  assert.equal(formatWhen(at, loc, 'mediumTime'), '12 Nov 2026, 3:05 pm');
});

test('formatWhen clock presets follow the language', () => {
  const at = '2026-11-12T09:35:00Z'; // 01:35 in Los Angeles
  const us = { timeZone: 'America/Los_Angeles', currency: 'USD', locale: 'en-US' };
  assert.equal(formatWhen(at, us, 'shortTime'), '1:35 AM');
  assert.equal(formatWhen(at, us, 'weekdayDayTime'), 'Thu, Nov 12, 1:35 AM');
  assert.equal(formatWhen(at, us, 'mediumTime'), 'Nov 12, 2026, 1:35 AM');
  assert.equal(formatWhen(at, { ...us, locale: 'en-GB' }, 'shortTime'), '01:35');
});

test('formatWhen uses the person\'s zone', () => {
  const loc = { timeZone: 'America/Los_Angeles', currency: 'USD', locale: 'en-US' };
  assert.equal(formatWhen('2026-11-12T04:00:00Z', loc, 'day'), 'Nov 11');
});
