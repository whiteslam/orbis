import { test } from 'vitest';
import assert from 'node:assert/strict';
import { eventKindFor, ghostedSummary, logisticsOnlyPrep, openAppsFrom, replyDetails, replyGmailQuery, retryClassification } from './watch-plan.ts';
import type { ReplyClassification } from './types.ts';
import { linkReply, replyCandidate } from './mail.ts';

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

const job = (over: Record<string, unknown> = {}) => ({
  company: 'Acme', source: 'greenhouse' as const, url: 'https://boards.greenhouse.io/acme/jobs/1', applyUrl: 'https://acme.io/careers/1',
  applyEmail: null, description: null, seenOn: [], requirements: null, ...over,
});

test('open apps carry the job’s company, its trusted domains and the thread', () => {
  const apps = [
    { id: 'a1', jobId: 'j1', gmailThreadId: 't1' },
    { id: 'a2', jobId: 'missing', gmailThreadId: null },
  ];
  assert.deepEqual(openAppsFrom(apps, new Map([['j1', job()]])), [{ id: 'a1', company: 'Acme', domains: ['acme.io'], threadId: 't1' }]);
});

test('an apply address from Hacker News doesn’t make its domain the company’s', () => {
  const hn = job({ source: 'hn', url: 'https://news.ycombinator.com/item?id=1', applyUrl: null, applyEmail: 'jobs@acme-hiring.io' });
  assert.deepEqual(openAppsFrom([{ id: 'a', jobId: 'j', gmailThreadId: null }], new Map([['j', hn]]))[0].domains, []);
  // From the company's own board it does.
  const own = job({ applyEmail: 'jobs@acme-careers.com' });
  assert.deepEqual(openAppsFrom([{ id: 'a', jobId: 'j', gmailThreadId: null }], new Map([['j', own]]))[0].domains, ['acme-careers.com', 'acme.io']);
});

test('a job alert merged into an applied job can’t add its site to the reply domains', () => {
  const merged = job({
    applyUrl: null,
    seenOn: [
      { source: 'gmail_alerts', url: 'https://attacker.example/jobs/sse-1', attribution: 'Job alert' },
      { source: 'greenhouse', url: 'https://boards.greenhouse.io/acme/jobs/1', attribution: null },
    ],
  });
  const open = openAppsFrom([{ id: 'a', jobId: 'j', gmailThreadId: null }], new Map([['j', merged]]));
  assert.deepEqual(open[0].domains, []);
  assert.equal(replyCandidate({ threadId: 't', from: 'HR <hr@attacker.example>', subject: 'x', snippet: 'x' }, open, new Set()), null);
  assert.equal(linkReply({ company: 'Acme' }, { threadId: 't', from: 'HR <hr@attacker.example>' }, open), null);
});

test('an unclassified reply waits for another try until it is 60 hours old', () => {
  const now = new Date('2026-10-27T12:00:00Z');
  assert.equal(retryClassification('2026-10-27T10:00:00Z', now), true);
  assert.equal(retryClassification('2026-10-24T23:00:00Z', now), false);
  assert.equal(retryClassification('not a date', now), false);
});

test('event details keep the headers and the classification, never a body', () => {
  const classification: ReplyClassification = {
    kind: 'interview_invite', company: 'Acme', role: 'FE', interviewAt: null, interviewFormat: 'video', meetingLink: null, offer: null, needsReply: true, summary: 'Invite',
  };
  const details = replyDetails({ from: 'jo@acme.io', subject: 'Interview', classification, reason: 'domain' });
  assert.equal(details.interviewFormat, 'video');
  assert.equal(details.matchedBy, 'domain');
  assert.equal(replyDetails({ from: 'a', subject: 'b', classification: null, reason: 'thread' }).classified, false);
  const unread = replyDetails({ from: 'a', subject: 'b', classification: null, reason: 'words', threadId: 't9', snippet: 'Hi', suggestedApplicationId: 'a1' });
  assert.deepEqual([unread.threadId, unread.snippet, unread.suggestedApplicationId], ['t9', 'Hi', 'a1']);
});

test('fallbacks read plainly', () => {
  assert.deepEqual(logisticsOnlyPrep({ at: null, format: 'phone', link: null }).likelyTopics, []);
  assert.match(ghostedSummary(21), /21 days/);
});
