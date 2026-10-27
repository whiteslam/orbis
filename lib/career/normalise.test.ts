import { test } from 'vitest';
import assert from 'node:assert/strict';
import { cleanList, cleanNumber, cleanText, locationBucket, normaliseCompany, normaliseTitle, readJsonObject } from './normalise.ts';

test('company names lose punctuation and legal suffixes', () => {
  assert.equal(normaliseCompany('Acme Technologies Pvt. Ltd.'), 'acme');
  assert.equal(normaliseCompany('Razorpay Software Private Limited'), 'razorpay');
  assert.equal(normaliseCompany('ACME, Inc.'), 'acme');
  assert.equal(normaliseCompany('Zoë Labs GmbH'), 'zoe');
  assert.equal(normaliseCompany("McDonald's Corp"), 'mcdonalds');
});

test('suffix words only go from the end, and never leave nothing', () => {
  assert.equal(normaliseCompany('Tech Mahindra'), 'tech mahindra');
  assert.equal(normaliseCompany('Software Inc'), 'software');
  assert.equal(normaliseCompany('The Browser Company'), 'browser');
});

test('titles normalise spelling, abbreviations and board noise, keeping seniority', () => {
  assert.equal(normaliseTitle('Sr. Front-End Dev (Remote)'), 'senior frontend developer');
  assert.equal(normaliseTitle('Front End Engineer'), normaliseTitle('Frontend Engineer'));
  assert.notEqual(normaliseTitle('Senior Frontend Engineer'), normaliseTitle('Junior Frontend Engineer'));
  assert.equal(normaliseTitle('Software Engineer (m/f/d)'), 'software engineer');
});

test('location buckets: remote, first place with aliases, or unknown', () => {
  assert.equal(locationBucket(null, true), 'remote');
  assert.equal(locationBucket('Berlin, Germany', true), 'remote');
  assert.equal(locationBucket('Remote - India', false), 'remote');
  assert.equal(locationBucket('Bangalore, Karnataka, India', false), 'bengaluru');
  assert.equal(locationBucket('Bengaluru', false), 'bengaluru');
  assert.equal(locationBucket('Gurgaon / Delhi NCR', false), 'gurugram');
  assert.equal(locationBucket('  ', false), 'unknown');
  assert.equal(locationBucket(null, false), 'unknown');
});

test('readJsonObject takes the object out of a fenced or chatty reply', () => {
  assert.deepEqual(readJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(readJsonObject('Here you go: {"a": {"b": 2}} Hope that helps'), { a: { b: 2 } });
  assert.equal(readJsonObject('[1,2]'), null);
  assert.equal(readJsonObject('{not json}'), null);
  assert.equal(readJsonObject('nothing'), null);
});

test('clean helpers', () => {
  assert.equal(cleanText('  a \n  b ', 10), 'a b');
  assert.equal(cleanText(5, 10), '');
  assert.deepEqual(cleanList(['x', ' x ', '', 3, 'y', 'z'], 2, 5), ['x', 'y']);
  assert.equal(cleanNumber('4.6', 0, 10, true), 5);
  assert.equal(cleanNumber(11, 0, 10), null);
  assert.equal(cleanNumber(Number.NaN, 0, 10), null);
});
