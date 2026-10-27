import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildFollowUpPrompt, daysBetween, fallbackFollowUp, isFollowUpDue, isGhosted, parseFollowUpReply, shortDate } from './followup.ts';

test('daysBetween counts calendar days', () => {
  assert.equal(daysBetween('2026-10-20T23:59:00Z', '2026-10-27'), 7);
  assert.equal(daysBetween('2026-10-27', '2026-10-20'), -7);
});

test('a follow-up is due on its day, only while no one has replied', () => {
  assert.ok(isFollowUpDue({ status: 'sent', followUpDue: '2026-10-27' }, '2026-10-27'));
  assert.ok(isFollowUpDue({ status: 'acknowledged', followUpDue: '2026-10-20' }, '2026-10-27'));
  assert.ok(!isFollowUpDue({ status: 'sent', followUpDue: '2026-10-28' }, '2026-10-27'));
  assert.ok(!isFollowUpDue({ status: 'interview', followUpDue: '2026-10-20' }, '2026-10-27'));
  assert.ok(!isFollowUpDue({ status: 'sent', followUpDue: null }, '2026-10-27'));
});

test('ghosted after ghostDays with no reply', () => {
  assert.ok(isGhosted({ status: 'sent', sentAt: '2026-10-06T10:00:00Z' }, '2026-10-27', 21));
  assert.ok(!isGhosted({ status: 'sent', sentAt: '2026-10-07T10:00:00Z' }, '2026-10-27', 21));
  assert.ok(!isGhosted({ status: 'replied', sentAt: '2026-01-01T10:00:00Z' }, '2026-10-27', 21));
  assert.ok(!isGhosted({ status: 'sent', sentAt: null }, '2026-10-27', 21));
});

test('the prompt carries the role, the date and the note', () => {
  const prompt = buildFollowUpPrompt({ name: 'Asha Rao', job: { title: 'Frontend engineer', company: 'Acme' }, sentAt: '2026-10-20T09:00:00Z', coverNote: 'I built X.' });
  assert.match(prompt.user, /Frontend engineer at Acme/);
  assert.match(prompt.user, /20 Oct/);
  assert.match(prompt.user, /I built X\./);
  assert.equal(shortDate('2026-01-05'), '5 Jan');
});

test('parseFollowUpReply refuses placeholders and essays', () => {
  assert.equal(parseFollowUpReply('{"body":"Hi Acme, just checking in. Thanks, Asha"}'), 'Hi Acme, just checking in. Thanks, Asha');
  assert.equal(parseFollowUpReply('{"body":"Thanks, [Your Name]"}'), null);
  assert.equal(parseFollowUpReply(JSON.stringify({ body: 'word '.repeat(200) })), null);
  assert.equal(parseFollowUpReply('{}'), null);
  assert.equal(parseFollowUpReply('oops'), null);
});

test('the fallback is short, polite and deterministic', () => {
  const text = fallbackFollowUp({ name: 'Asha Rao', job: { title: 'Frontend engineer', company: 'Acme' }, sentAt: '2026-10-20T09:00:00Z' });
  assert.ok(text.split(/\s+/).length <= 90);
  assert.match(text, /^Hello Acme team,/);
  assert.match(text, /Frontend engineer role on 20 Oct/);
  assert.match(text, /Asha Rao$/);
  assert.equal(text, fallbackFollowUp({ name: 'Asha Rao', job: { title: 'Frontend engineer', company: 'Acme' }, sentAt: '2026-10-20T09:00:00Z' }));
});
