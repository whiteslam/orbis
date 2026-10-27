import { test } from 'vitest';
import assert from 'node:assert/strict';
import { csvCell, toCsv, TRACKER_HEADER, trackerCsv, type TrackerRow } from './csv.ts';

test('cells are quoted, with quotes doubled', () => {
  assert.equal(csvCell('Acme'), '"Acme"');
  assert.equal(csvCell('Say "hi", then go'), '"Say ""hi"", then go"');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(72), '"72"');
  assert.equal(csvCell('line one\nline two'), '"line one\nline two"');
});

test('anything a spreadsheet would run as a formula stays text', () => {
  assert.equal(csvCell('=HYPERLINK("http://x","y")'), `"'=HYPERLINK(""http://x"",""y"")"`);
  assert.equal(csvCell('+91 98765'), `"'+91 98765"`);
  assert.equal(csvCell('-2+3'), `"'-2+3"`);
  assert.equal(csvCell('@SUM(A1)'), `"'@SUM(A1)"`);
  assert.equal(csvCell('\t=1'), `"'\t=1"`);
  assert.equal(csvCell('a=b'), '"a=b"');
});

test('rows end in CRLF', () => {
  assert.equal(toCsv([['a', 'b'], ['c', null]]), '"a","b"\r\n"c",""');
});

const row = (company: string, lastEventAt: string | null): TrackerRow => ({
  application: {
    status: 'sent', route: 'email', sentAt: '2026-10-20T09:00:00Z', followUpDue: '2026-10-27T00:00:00Z', lastEventAt,
    prediction: { reply: 0.2, replyRange: [0.1, 0.3], interview: 0.1, interviewRange: [0.05, 0.15], early: true, basedOn: 0 },
    notes: null, updatedAt: '2026-10-20T09:00:00Z',
  },
  job: { title: 'Frontend engineer', company, location: 'Bengaluru', remote: true, score: 72, source: 'greenhouse', url: 'https://boards.greenhouse.io/acme/jobs/1', applyUrl: null },
  latest: 'Sent to jobs@acme.com from Gmail',
});

test('the tracker has a header and the newest activity first', () => {
  const csv = trackerCsv([row('Older', '2026-10-01T00:00:00Z'), row('Newer', '2026-10-25T00:00:00Z')]);
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], TRACKER_HEADER.map((cell) => `"${cell}"`).join(','));
  assert.ok(lines[1].startsWith(
    '"Newer","Frontend engineer","sent","email","72","2026-10-20","Sent to jobs@acme.com from Gmail","2026-10-25","2026-10-27","10–30% (early estimate)","Remote · Bengaluru","greenhouse"',
  ));
  assert.ok(lines[2].startsWith('"Older"'));
});

test('a hostile company name in the tracker is neutralised', () => {
  const csv = trackerCsv([row('=cmd|"/c calc"!A1', null)]);
  assert.ok(csv.split('\r\n')[1].startsWith(`"'=cmd|""/c calc""!A1"`));
});
