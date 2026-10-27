import { test } from 'vitest';
import assert from 'node:assert/strict';
import { locationBucket, normaliseCompany, normaliseTitle } from './normalise.ts';

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
