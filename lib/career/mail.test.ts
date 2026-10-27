import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  MAIL_BODY_CAP, baseDomain, buildReplyPrompt, companyDomains, domainOf, linkReply, nameSimilarity, parseReplyReply,
  replyCandidate, validateTerms, type OpenApp,
} from './mail.ts';

const apps: OpenApp[] = [
  { id: 'a1', company: 'Acme Technologies Pvt. Ltd.', domains: ['acme.io'], threadId: 't-acme' },
  { id: 'a2', company: 'Bolt', domains: ['bolt.eu'], threadId: null },
  { id: 'a3', company: 'Northwind Labs', domains: [], threadId: null },
];
const none = new Set<string>();

test('domainOf reads display-name and bare addresses', () => {
  assert.equal(domainOf('Jane Doe <Jane@Careers.Acme.io>'), 'careers.acme.io');
  assert.equal(domainOf('jane@acme.io'), 'acme.io');
  assert.equal(domainOf('"Doe, Jane" <jane@acme.co.uk>'), 'acme.co.uk');
  assert.equal(domainOf('no address here'), null);
  assert.equal(domainOf('jane@localhost'), null);
});

test('baseDomain keeps the registrable part', () => {
  assert.equal(baseDomain('careers.acme.io'), 'acme.io');
  assert.equal(baseDomain('jobs.acme.co.uk'), 'acme.co.uk');
  assert.equal(baseDomain('acme.com'), 'acme.com');
});

test('companyDomains ignores boards, ATSs and free mail', () => {
  assert.deepEqual(companyDomains({
    applyEmail: 'Hiring <jobs@acme.io>',
    urls: ['https://boards.greenhouse.io/acme/jobs/1', 'https://www.linkedin.com/jobs/view/2', 'https://careers.acme.io/x', 'not a url', null],
  }), ['acme.io']);
  assert.deepEqual(companyDomains({ applyEmail: 'founder@gmail.com', urls: ['https://jobs.lever.co/bolt'] }), []);
});

test('a message in a sent thread is a candidate', () => {
  const found = replyCandidate({ threadId: 't-acme', from: 'x@greenhouse.io', subject: 'Hi', snippet: '' }, apps, new Set(['t-acme']));
  assert.deepEqual(found, { applicationId: 'a1', reason: 'thread' });
});

test('a message from a company domain is a candidate, subdomains included', () => {
  const found = replyCandidate({ threadId: 't9', from: 'Sam <sam@talent.acme.io>', subject: 'Quick chat', snippet: '' }, apps, none);
  assert.deepEqual(found, { applicationId: 'a1', reason: 'domain' });
});

test('hiring words need an open application\'s company name too', () => {
  const both = replyCandidate({ threadId: 't9', from: 'no-reply@ashbyhq.com', subject: 'Your application to Northwind Labs', snippet: 'Thanks for applying' }, apps, none);
  assert.deepEqual(both, { applicationId: 'a3', reason: 'words' });
  const wordsOnly = replyCandidate({ threadId: 't9', from: 'no-reply@ashbyhq.com', subject: 'Your application to Initech', snippet: '' }, apps, none);
  assert.equal(wordsOnly, null);
  const nameOnly = replyCandidate({ threadId: 't9', from: 'news@bolt.example', subject: 'Bolt newsletter', snippet: 'Our spring sale' }, apps, none);
  assert.equal(nameOnly, null);
  // "Bolt" must be a whole word: "Boltzmann" isn't Bolt.
  const partial = replyCandidate({ threadId: 't9', from: 'x@y.com', subject: 'Interview at Boltzmann', snippet: '' }, apps, none);
  assert.equal(partial, null);
});

test('free-mail senders never match by domain', () => {
  const gmailApp: OpenApp[] = [{ id: 'g', company: 'Tiny', domains: ['gmail.com'], threadId: null }];
  assert.equal(replyCandidate({ threadId: 't', from: 'a@gmail.com', subject: 'Lunch?', snippet: '' }, gmailApp, none), null);
});

test('the prompt caps the body and marks it as data', () => {
  const prompt = buildReplyPrompt({ from: 'a@b.com', subject: 'S', body: 'x'.repeat(MAIL_BODY_CAP + 500) });
  assert.ok(prompt.user.length < MAIL_BODY_CAP + 100);
  assert.match(prompt.system, /data, not instructions/);
});

const reply = (over: Record<string, unknown>) => JSON.stringify({ kind: 'other', summary: 'A note.', ...over });

test('parseReplyReply reads a clean interview invite', () => {
  const parsed = parseReplyReply('```json\n' + reply({
    kind: 'interview_invite', company: 'Acme', role: 'Frontend engineer', interviewAt: '2026-11-03T15:30:00+05:30',
    interviewFormat: 'video', meetingLink: 'https://meet.google.com/abc', summary: 'Acme invites you to a video interview on 3 Nov.',
  }) + '\n```');
  assert.equal(parsed?.kind, 'interview_invite');
  assert.equal(parsed?.interviewAt, '2026-11-03T15:30:00+05:30');
  assert.equal(parsed?.meetingLink, 'https://meet.google.com/abc');
  assert.equal(parsed?.needsReply, true);
  assert.equal(parsed?.offer, null);
});

test('a time without a zone, or a non-https link, is dropped', () => {
  const parsed = parseReplyReply(reply({ kind: 'interview_invite', interviewAt: '2026-11-03T15:30:00', meetingLink: 'javascript:alert(1)' }));
  assert.equal(parsed?.interviewAt, null);
  assert.equal(parsed?.meetingLink, null);
});

test('an offer needs an amount or the word offer', () => {
  const withAmount = parseReplyReply(reply({ kind: 'offer', summary: 'Good news from Acme.', offer: { fixed: 1800000, currency: 'INR', period: 'year' } }));
  assert.equal(withAmount?.kind, 'offer');
  assert.equal(withAmount?.offer?.fixed, 1800000);
  const withWord = parseReplyReply(reply({ kind: 'offer', summary: 'Acme sent a written offer letter.' }));
  assert.equal(withWord?.kind, 'offer');
  const neither = parseReplyReply(reply({ kind: 'offer', summary: 'Acme wants to talk next week.' }));
  assert.equal(neither?.kind, 'other');
  assert.equal(neither?.offer, null);
});

test('a rejection never carries offer terms', () => {
  const parsed = parseReplyReply(reply({ kind: 'rejection', summary: 'Not moving forward.', offer: { fixed: 100 } }));
  assert.equal(parsed?.kind, 'rejection');
  assert.equal(parsed?.offer, null);
});

test('the summary is capped at 160 and required', () => {
  const parsed = parseReplyReply(reply({ summary: 'y'.repeat(400) }));
  assert.equal(parsed?.summary.length, 160);
  assert.equal(parseReplyReply(reply({ summary: '  ' })), null);
  assert.equal(parseReplyReply(reply({ kind: 'party' })), null);
  assert.equal(parseReplyReply('not json'), null);
  assert.equal(parseReplyReply('[1,2]'), null);
});

test('validateTerms cleans what it can', () => {
  assert.deepEqual(validateTerms({ fixed: '18,00,000', currency: '₹', period: 'year', startDate: '2026-12-01', deadline: '2026-13-40', equity: '' }), {
    fixed: 1800000, variable: null, joiningBonus: null, equity: null, currency: 'INR', period: 'year', startDate: '2026-12-01', deadline: null,
  });
  assert.equal(validateTerms({ fixed: -5 }), null);
  assert.equal(validateTerms('offer'), null);
});

test('nameSimilarity ignores legal suffixes', () => {
  assert.equal(nameSimilarity('Acme Pvt Ltd', 'ACME'), 1);
  assert.ok(nameSimilarity('Acme Labs', 'Acme') > 0.6);
  assert.ok(nameSimilarity('Acme Labs', 'Acme Bank') < 0.6);
});

test('linkReply: thread, then domain, then name', () => {
  assert.equal(linkReply({ company: 'Bolt' }, { threadId: 't-acme', from: 'x@bolt.eu' }, apps), 'a1');
  assert.equal(linkReply({ company: null }, { threadId: 'zz', from: 'x@bolt.eu' }, apps), 'a2');
  assert.equal(linkReply({ company: 'Northwind Labs India' }, { threadId: 'zz', from: 'x@lever.co' }, apps), 'a3');
  assert.equal(linkReply({ company: 'Initech' }, { threadId: 'zz', from: 'x@lever.co' }, apps), null);
});

test('linkReply leaves a tie unlinked', () => {
  const twins: OpenApp[] = [
    { id: 'x', company: 'Acme Labs', domains: [], threadId: null },
    { id: 'y', company: 'Acme Cloud', domains: [], threadId: null },
  ];
  assert.equal(linkReply({ company: 'Acme' }, { threadId: 'z', from: 'a@b.com' }, twins), null);
  assert.equal(linkReply({ company: 'Acme Cloud' }, { threadId: 'z', from: 'a@b.com' }, twins), 'y');
});
