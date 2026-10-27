import { test } from 'vitest';
import assert from 'node:assert/strict';
import { eventKindFor, ghostedSummary, logisticsOnlyPrep, openAppsFrom, replyDetails, replyGmailQuery } from './watch-plan.ts';
import type { ReplyClassification } from './types.ts';

test('the reply search skips the owner’s own mail, promotions and the alert senders', () => {
  const query = replyGmailQuery();
  assert.match(query, /newer_than:3d/);
  assert.match(query, /-from:me/);
  assert.match(query, /-category:promotions/);
  assert.match(query, /jobalerts-noreply@linkedin\.com/);
  // Whole domains are not excluded: a recruiter may write from naukri.com.
  assert.doesNotMatch(query, /naukri\.com/);
});

test('every reply kind has an event; "other" is a plain reply', () => {
  assert.equal(eventKindFor('interview_invite'), 'interview_invite');
  assert.equal(eventKindFor('rejection'), 'rejection');
  assert.equal(eventKindFor('other'), 'reply');
});

test('open apps carry the job’s company, their domains and thread', () => {
  const apps = [
    { id: 'a1', jobId: 'j1', companyDomains: ['acme.io'], gmailThreadId: 't1' },
    { id: 'a2', jobId: 'missing', companyDomains: [], gmailThreadId: null },
  ];
  assert.deepEqual(openAppsFrom(apps, new Map([['j1', { company: 'Acme' }]])), [{ id: 'a1', company: 'Acme', domains: ['acme.io'], threadId: 't1' }]);
});

test('event details keep the headers and the classification, never a body', () => {
  const classification: ReplyClassification = {
    kind: 'interview_invite', company: 'Acme', role: 'FE', interviewAt: null, interviewFormat: 'video', meetingLink: null, offer: null, needsReply: true, summary: 'Invite',
  };
  const details = replyDetails({ from: 'jo@acme.io', subject: 'Interview', classification, reason: 'domain' });
  assert.equal(details.interviewFormat, 'video');
  assert.equal(details.matchedBy, 'domain');
  assert.equal(replyDetails({ from: 'a', subject: 'b', classification: null, reason: 'thread' }).classified, false);
});

test('fallbacks read plainly', () => {
  assert.deepEqual(logisticsOnlyPrep({ at: null, format: 'phone', link: null }).likelyTopics, []);
  assert.match(ghostedSummary(21), /21 days/);
});
