import { test } from 'vitest';
import assert from 'node:assert/strict';
import { fit, followUpHeadsup, headsupKindFor, replyHeadsup, whenText } from './notify.ts';

test('only invites, offers and questions raise a heads-up', () => {
  assert.equal(headsupKindFor('interview_invite'), 'career.interview');
  assert.equal(headsupKindFor('offer'), 'career.offer');
  assert.equal(headsupKindFor('recruiter_question'), 'career.question');
  assert.equal(headsupKindFor('rejection'), null);
  assert.equal(headsupKindFor('acknowledgement'), null);
  assert.equal(headsupKindFor('other'), null);
});

test('interview times read in the owner’s own zone, without a locale', () => {
  assert.equal(whenText('2026-11-03T15:30:00+05:30'), 'Tue 3 Nov, 15:30');
  assert.equal(whenText(null), null);
  assert.equal(whenText('soon'), null);
});

test('text is cut on a word with an ellipsis', () => {
  assert.equal(fit('short', 10), 'short');
  assert.equal(fit('one two three four five', 12), 'one two…');
  assert.ok(fit('x'.repeat(100), 20).length <= 20);
});

test('an interview heads-up is urgent, keyed by message, and opens the application', () => {
  const headsup = replyHeadsup({
    kind: 'career.interview', applicationId: 'app-1', messageId: 'msg-1', company: 'Acme', role: 'Frontend Engineer',
    summary: 'They want a 45-minute video call.', at: '2026-11-03T15:30:00+05:30',
  });
  assert.equal(headsup.urgency, 'urgent');
  assert.equal(headsup.dedupeKey, 'career.interview:msg-1');
  assert.equal(headsup.title, 'Interview with Acme, Tue 3 Nov, 15:30');
  assert.equal(headsup.body, 'Frontend Engineer: They want a 45-minute video call.');
  assert.deepEqual(headsup.action, { type: 'open_career_application', applicationId: 'app-1' });
});

test('titles, bodies and labels fit the table’s limits', () => {
  const long = 'Very Long Company Name '.repeat(10);
  const headsup = replyHeadsup({ kind: 'career.offer', applicationId: 'a', messageId: 'm', company: long, role: long, summary: long });
  assert.ok(headsup.title.length <= 80);
  assert.ok(headsup.body.length <= 300);
  assert.ok(headsup.actionLabel.length <= 40);
});

test('a follow-up heads-up is normal and keyed per application and day', () => {
  const headsup = followUpHeadsup({ applicationId: 'app-1', company: 'Acme', role: 'Frontend Engineer', day: '2026-10-27' });
  assert.equal(headsup.urgency, 'normal');
  assert.equal(headsup.dedupeKey, 'career.follow_up:app-1:2026-10-27');
  assert.match(headsup.body, /only when you press Send/);
});
