import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseJobspresso } from './jobspresso.ts';

const xml = readFileSync(new URL('./fixtures/jobspresso.xml', import.meta.url), 'utf8');

test('reads every item in a real feed with its job_listing fields', () => {
  const jobs = parseJobspresso(xml);
  assert.equal(jobs.length, 4);
  const [first] = jobs;
  assert.equal(first.title, 'Sr. Director, Marketing Strategy, Analytics & Innovation');
  assert.equal(first.company, 'Twilio');
  assert.equal(first.location, 'United States');
  assert.equal(first.remote, true);
  assert.equal(first.sourceRef, 'https://jobspresso.co/?post_type=job_listing&p=164422');
  assert.deepEqual(first.salary, { min: 228_000, max: 285_000, currency: 'USD', period: 'year' });
  assert.equal(first.attribution, 'via Jobspresso');
  assert.ok(first.description?.startsWith('Who We Are\nAt Twilio, we’re shaping'));
});

test('falls back to dc:creator for company and place', () => {
  const item = '<item><title>Dev</title><link>https://jobspresso.co/job/dev/</link><dc:creator><![CDATA[Acme<br>⚲&nbsp;Europe]]></dc:creator></item>';
  const [job] = parseJobspresso(`<rss><channel>${item}</channel></rss>`);
  assert.equal(job.company, 'Acme');
  assert.equal(job.location, 'Europe');
});
