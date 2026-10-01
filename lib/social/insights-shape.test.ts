import { test } from 'vitest';
import assert from 'node:assert/strict';
import { compactCount, isMetaCdnUrl, labelled, metaErrorKind, metricValue, shortText, INSTAGRAM_METRICS } from './insights-shape.ts';

test('an account total is read from total_value', () => {
  const body = { data: [{ name: 'reach', period: 'day', total_value: { value: 1234 } }] };
  assert.equal(metricValue(body, 'reach'), 1234);
});

test('a time series is summed, so 28 days of views become one number', () => {
  const body = { data: [{ name: 'views', period: 'day', values: [{ value: 10, end_time: 'a' }, { value: 5, end_time: 'b' }, { value: 0 }] }] };
  assert.equal(metricValue(body, 'views'), 15);
});

test('a per-post lifetime value comes back in values[0]', () => {
  assert.equal(metricValue({ data: [{ name: 'likes', period: 'lifetime', values: [{ value: 7 }] }] }, 'likes'), 7);
});

test('a metric Meta did not answer, or answered with nonsense, is null rather than zero', () => {
  assert.equal(metricValue({ data: [] }, 'reach'), null);
  assert.equal(metricValue({ data: [{ name: 'reach', total_value: { value: 'lots' } }] }, 'reach'), null);
  assert.equal(metricValue({ data: [{ name: 'reach', values: [] }] }, 'reach'), null);
  assert.equal(metricValue(null, 'reach'), null);
  assert.equal(metricValue({ error: { code: 100 } }, 'reach'), null);
});

test('a real zero is kept: a quiet month is not missing data', () => {
  assert.equal(metricValue({ data: [{ name: 'shares', total_value: { value: 0 } }] }, 'shares'), 0);
});

test('labelled keeps display order and leaves out what is missing', () => {
  const values = new Map<string, number | null>([['likes', 4], ['views', 100], ['reach', null]]);
  assert.deepEqual(labelled(INSTAGRAM_METRICS, values).map((metric) => metric.key), ['views', 'likes']);
});

test('Meta errors are told apart: dead token, missing permission, anything else', () => {
  assert.equal(metaErrorKind({ error: { code: 190, message: 'Error validating access token' } }), 'token');
  assert.equal(metaErrorKind({ error: { code: 10, message: 'Application does not have permission' } }), 'permission');
  assert.equal(metaErrorKind({ error: { code: 200 } }), 'permission');
  assert.equal(metaErrorKind({ error: { code: 100, message: 'Invalid metric' } }), 'other');
  assert.equal(metaErrorKind(null), 'other');
});

test('captions are cut to one line', () => {
  assert.equal(shortText('  two\n\nlines  '), 'two lines');
  assert.equal(shortText('x'.repeat(100), 10), `${'x'.repeat(9)}…`);
  assert.equal(shortText(undefined), '');
});

test('counts are compact', () => {
  assert.equal(compactCount(950), '950');
  assert.equal(compactCount(1200), '1.2K');
  assert.equal(compactCount(1000), '1K');
  assert.equal(compactCount(34_400), '34K');
  assert.equal(compactCount(1_500_000), '1.5M');
});

test('only https images on Meta CDNs may be fetched through the thumbnail route', () => {
  assert.equal(isMetaCdnUrl('https://scontent-bom1-1.cdninstagram.com/v/t51.jpg?oh=1&oe=2'), true);
  assert.equal(isMetaCdnUrl('https://scontent.xx.fbcdn.net/v/abc.jpg'), true);
  assert.equal(isMetaCdnUrl('https://cdninstagram.com/a.jpg'), true);
  assert.equal(isMetaCdnUrl('http://scontent.cdninstagram.com/a.jpg'), false, 'not https');
  assert.equal(isMetaCdnUrl('https://cdninstagram.com.evil.example/a.jpg'), false, 'lookalike host');
  assert.equal(isMetaCdnUrl('https://evilcdninstagram.com/a.jpg'), false, 'suffix without a dot');
  assert.equal(isMetaCdnUrl('https://user:pw@scontent.cdninstagram.com/a.jpg'), false, 'credentials');
  assert.equal(isMetaCdnUrl('https://scontent.cdninstagram.com:8443/a.jpg'), false, 'odd port');
  assert.equal(isMetaCdnUrl('https://169.254.169.254/latest'), false);
  assert.equal(isMetaCdnUrl('not a url'), false);
  assert.equal(isMetaCdnUrl(null), false);
});
