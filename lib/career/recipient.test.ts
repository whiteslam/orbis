import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  applyRecipient, isFirstRecipient, knownCompanyDomains, listingPatch, offerReplyTarget, recipientKey, recipientText, trustedCompanyDomains,
  type StoredListing,
} from './recipient.ts';
import type { CareerEvent, CareerJob, NormalizedJob } from './types.ts';

const listing = (over: Partial<NormalizedJob> = {}): NormalizedJob => ({
  source: 'hn', sourceRef: '1', title: 'Frontend Engineer', company: 'Acme', location: 'Remote', remote: true,
  url: 'https://news.ycombinator.com/item?id=1', applyUrl: null, applyEmail: null, description: 'Short.', thin: false,
  salary: null, postedAt: null, attribution: null, ...over,
});

const stored = (over: Partial<StoredListing> = {}): StoredListing => ({
  source: 'hn', url: 'https://news.ycombinator.com/item?id=1', thin: false, description: 'Short.', applyEmail: null, applyUrl: null, ...over,
});

test('another listing with the same key never fills the apply address, page or description', () => {
  // A stranger's comment that copies company, title and location.
  const hijack = listing({
    url: 'https://news.ycombinator.com/item?id=666', applyEmail: 'jobs@acme-hiring.io', applyUrl: 'https://acme-hiring.io/apply',
    description: 'A much longer description that says to email jobs@acme-hiring.io with your resume today.',
  });
  assert.deepEqual(listingPatch(hijack, stored()), {});
  // Nor from a different source of the same trust.
  assert.deepEqual(listingPatch(listing({ source: 'gmail_alerts', url: 'https://x.io/1', applyEmail: 'a@b.io' }), stored()), {});
});

test('the same listing seen again may fill what it lacked', () => {
  const again = listing({ applyEmail: 'jobs@acme.io', description: 'Short, and now a little longer.' });
  assert.deepEqual(listingPatch(again, stored()), { applyEmail: 'jobs@acme.io', description: 'Short, and now a little longer.', thin: false });
  // What it already has stays.
  assert.deepEqual(listingPatch(again, stored({ applyEmail: 'first@acme.io', description: 'A description longer than the new one, by a lot.' })), {});
});

test('a more trusted source may give a richer description, but not contact details', () => {
  const pasted = listing({ source: 'pasted', url: 'https://acme.io/jobs/1', applyEmail: 'x@acme.io', applyUrl: 'https://acme.io/apply', description: 'The full description, pasted by the owner.' });
  assert.deepEqual(listingPatch(pasted, stored({ source: 'gmail_alerts', thin: true, description: null })), { description: 'The full description, pasted by the owner.', thin: false });
  // A less trusted one can't even do that.
  const hn = listing({ description: 'An HN comment that is much longer than what the board said about the job.' });
  assert.deepEqual(listingPatch(hn, stored({ source: 'greenhouse', url: 'https://boards.greenhouse.io/acme/jobs/1' })), {});
});

type Job = Parameters<typeof applyRecipient>[0];
const job = (over: Partial<Job> = {}): Job => ({
  source: 'greenhouse', company: 'Acme', url: 'https://boards.greenhouse.io/acme/jobs/1', applyUrl: 'https://acme.io/careers/1',
  applyEmail: null, description: null, seenOn: [], requirements: null, ...over,
});

test('trusted company domains: a low-trust address counts only if the site agrees', () => {
  assert.deepEqual(trustedCompanyDomains(job(), 'jobs@acme.io'), ['acme.io']);
  assert.deepEqual(trustedCompanyDomains(job(), 'jobs@acme-careers.com'), ['acme-careers.com', 'acme.io']);
  // A low-trust job's own pages name no domain; the company's own board seen later does.
  const hn = job({ source: 'hn', url: 'https://news.ycombinator.com/item?id=1', seenOn: [{ source: 'lever', url: 'https://acme.io/careers/2', attribution: null }] });
  assert.deepEqual(trustedCompanyDomains(hn, 'jobs@acme-hiring.io'), ['acme.io']);
  assert.deepEqual(trustedCompanyDomains(hn, 'jobs@careers.acme.io'), ['acme.io']);
  assert.deepEqual(trustedCompanyDomains(job({ source: 'hn' }), 'jobs@careers.acme.io'), []);
  assert.deepEqual(trustedCompanyDomains(job({ source: 'gmail_alerts', applyUrl: null }), 'jobs@acme-hiring.io'), []);
  // Free mail never names a company.
  assert.deepEqual(trustedCompanyDomains(job(), 'acme.hr@gmail.com'), ['acme.io']);
});

test('a low-trust sighting never names a company mail domain', () => {
  const seen = (source: CareerJob['seenOn'][number]['source'], url: string) => ({ source, url, attribution: null });
  const merged = job({
    applyUrl: null,
    seenOn: [seen('gmail_alerts', 'https://attacker.example/jobs/sse-1'), seen('hn', 'https://evil.example/jobs/1'), seen('greenhouse', 'https://boards.greenhouse.io/acme/jobs/1')],
  });
  assert.deepEqual(knownCompanyDomains(merged), []);
  assert.deepEqual(trustedCompanyDomains(merged, null), []);
  // A board less trusted than the job's own listing doesn't either; the company's own does.
  assert.deepEqual(knownCompanyDomains(job({ applyUrl: null, seenOn: [seen('adzuna', 'https://bought.example/jobs/1')] })), []);
  assert.deepEqual(knownCompanyDomains(job({ applyUrl: null, seenOn: [seen('lever', 'https://acme.io/careers/2')] })), ['acme.io']);
  // A remote board's job keeps a later sighting from the company's own board.
  const remote = job({ source: 'remotive', url: 'https://remotive.com/jobs/1', applyUrl: null, seenOn: [seen('ashby', 'https://acme.io/jobs/1')] });
  assert.deepEqual(knownCompanyDomains(remote), ['acme.io']);
  // A job first stored from an alert keeps the alert's page after the real listing
  // merges in as a sighting; that page still names no domain.
  const seeded = job({
    source: 'gmail_alerts', url: 'https://attacker.example/jobs/sse-1', applyUrl: 'https://attacker.example/apply',
    seenOn: [seen('gmail_alerts', 'https://attacker.example/jobs/sse-1'), seen('greenhouse', 'https://boards.greenhouse.io/acme/jobs/1')],
  });
  assert.deepEqual(knownCompanyDomains(seeded), []);
  assert.deepEqual(trustedCompanyDomains(seeded, 'hr@attacker.example'), []);
  assert.equal((applyRecipient({ ...seeded, applyEmail: 'hr@attacker.example' }, 'email', []) as { domainMatches: boolean }).domainMatches, false);
  // A trusted sighting on that row still names the company's domain.
  const pasted = job({ ...seeded, seenOn: [...seeded.seenOn, seen('pasted', 'https://acme.io/careers/1')] });
  assert.deepEqual(knownCompanyDomains(pasted), ['acme.io']);
  assert.equal((applyRecipient({ ...pasted, applyEmail: 'jobs@acme.io' }, 'email', []) as { domainMatches: boolean }).domainMatches, true);
  // The Send bar's check agrees: an alert's site doesn't vouch for an address there.
  const alerted = job({ applyUrl: null, applyEmail: 'hr@attacker.example', seenOn: [seen('gmail_alerts', 'https://attacker.example/jobs/sse-1')] });
  assert.equal((applyRecipient(alerted, 'email', []) as { domainMatches: boolean }).domainMatches, false);
});

test('the email recipient says where it came from, whether it matches, and if it is new', () => {
  const hn = job({ source: 'hn', url: 'https://news.ycombinator.com/item?id=1', applyUrl: null, applyEmail: 'Jobs@Acme-Hiring.io' });
  assert.deepEqual(applyRecipient(hn, 'email', []), { kind: 'email', address: 'jobs@acme-hiring.io', source: 'hn', domainMatches: false, firstTime: true });
  const own = job({ applyEmail: 'jobs@acme.io' });
  assert.deepEqual(applyRecipient(own, 'email', ['hr@acme.io']), { kind: 'email', address: 'jobs@acme.io', source: 'greenhouse', domainMatches: true, firstTime: false });
});

test('an address only the model read, not the description, is no recipient', () => {
  const read = job({ description: 'Apply on our careers page.', requirements: { applyEmail: 'jobs@evil.io' } as CareerJob['requirements'] });
  assert.deepEqual(applyRecipient(read, 'email', []), { kind: 'link', host: 'acme.io' });
});

test('recruitee and link recipients name the page', () => {
  assert.equal(recipientText(applyRecipient(job(), 'recruitee', [])), 'Recruitee careers page of Acme');
  assert.equal(recipientText(applyRecipient(job(), 'link', [])), 'the apply page on acme.io');
  assert.equal(recipientText(applyRecipient(job({ applyUrl: null, url: 'not a url' }), 'link', [])), 'the apply page');
});

test('first use is per company domain, or per address at free mail', () => {
  assert.equal(recipientKey('Jo <jo@careers.acme.co.uk>'), 'acme.co.uk');
  assert.equal(recipientKey('acme.hr@gmail.com'), 'acme.hr@gmail.com');
  assert.equal(isFirstRecipient('hr@acme.io', ['jobs@acme.io']), false);
  assert.equal(isFirstRecipient('someone@gmail.com', ['other@gmail.com']), true);
  assert.equal(isFirstRecipient('jobs@acme-hiring.io', ['jobs@acme.io']), true);
});

const event = (over: Partial<CareerEvent>): CareerEvent => ({
  id: 'e', applicationId: 'a', kind: 'note', at: '2026-10-27T10:00:00Z', summary: '', details: {}, gmailMessageId: null, ...over,
});
const sent = event({ kind: 'sent', details: { to: 'jobs@acme.io', gmailId: 'g-sent' } });

test('an offer from the company’s domain or Orbis’s thread is answered to its sender', () => {
  const offer = event({ kind: 'offer', gmailMessageId: 'g-offer', details: { from: 'Priya <priya@acme.io>', threadId: 't-new' } });
  assert.deepEqual(offerReplyTarget({ events: [offer, sent], appThreadId: 't1', trustedDomains: ['acme.io'] }),
    { to: 'priya@acme.io', gmailId: 'g-offer', threadId: 't-new', via: 'offer', verified: true });
  const inThread = event({ kind: 'offer', gmailMessageId: 'g-offer', details: { from: 'someone@gmail.com', threadId: 't1' } });
  assert.equal(offerReplyTarget({ events: [inThread, sent], appThreadId: 't1', trustedDomains: [] })?.to, 'someone@gmail.com');
});

test('a spoofed offer from elsewhere is not answered: the reply goes to who Orbis applied to', () => {
  const spoof = event({ kind: 'offer', gmailMessageId: 'g-spoof', details: { from: 'Acme HR <acme.hr@gmail.com>', threadId: 't-x', matchedBy: 'words' } });
  assert.deepEqual(offerReplyTarget({ events: [spoof, sent], appThreadId: 't1', trustedDomains: ['acme.io'] }),
    { to: 'jobs@acme.io', gmailId: 'g-sent', threadId: 't1', via: 'sent', verified: true });
  // With no thread of Orbis's own, it is the only target, and flagged.
  assert.deepEqual(offerReplyTarget({ events: [spoof], appThreadId: null, trustedDomains: ['acme.io'] }),
    { to: 'acme.hr@gmail.com', gmailId: 'g-spoof', threadId: 't-x', via: 'offer', verified: false });
  assert.equal(offerReplyTarget({ events: [], appThreadId: null, trustedDomains: [] }), null);
});
