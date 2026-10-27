import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  addDays, applicationBody, applicationSubject, buildPasteKit, COMPOSE_BODY_MAX, composeUrl, formatMoney, oneLine, recruiteeEndpoint,
  replyReferences, replySubject, resumeFileName, signature,
} from './send-plan.ts';

const contact = {
  name: 'Asha Rao', email: 'asha@example.com', phone: '+91 98765 43210', location: 'Bengaluru',
  links: [{ label: 'GitHub', url: 'https://github.com/asha' }, { label: 'LinkedIn', url: 'https://www.linkedin.com/in/asha' }],
};

test('subject and file name come from the job and the profile, on one line', () => {
  assert.equal(applicationSubject('Frontend Engineer', 'Asha Rao'), 'Application: Frontend Engineer — Asha Rao');
  assert.equal(applicationSubject('Lead\r\nBcc: x@y.z', 'Asha'), 'Application: Lead Bcc: x@y.z — Asha');
  assert.equal(applicationSubject('Engineer', ''), 'Application: Engineer');
  assert.equal(resumeFileName('Asha Rao'), 'Asha Rao - Resume.pdf');
  assert.equal(resumeFileName('A/B: "C"', 'docx'), 'A B C - Resume.docx');
  assert.equal(resumeFileName(''), 'Resume.pdf');
  assert.equal(oneLine('  a\n\n b  '), 'a b');
});

test('the body is the cover note, then a short signature with LinkedIn first', () => {
  assert.equal(signature(contact), 'Asha Rao\n+91 98765 43210 · asha@example.com\nhttps://www.linkedin.com/in/asha');
  assert.equal(
    applicationBody('Hello team,\nI build things.', contact),
    'Hello team,\nI build things.\n\nAsha Rao\n+91 98765 43210 · asha@example.com\nhttps://www.linkedin.com/in/asha',
  );
  assert.equal(applicationBody(null, { ...contact, phone: null, links: [] }), 'Asha Rao\nasha@example.com');
});

test('the compose link is Gmail’s own, URL-encoded, with the body capped', () => {
  const url = composeUrl({ to: 'jobs@acme.com', subject: 'Application: Dev — Asha & co', body: 'Line 1\nLine 2' });
  assert.ok(url.startsWith('https://mail.google.com/mail/?view=cm&fs=1&to=jobs%40acme.com&su='));
  const params = new URL(url).searchParams;
  assert.equal(params.get('su'), 'Application: Dev — Asha & co');
  assert.equal(params.get('body'), 'Line 1\nLine 2');
  const long = new URL(composeUrl({ to: 'a@b.co', subject: 's', body: 'x'.repeat(5000) })).searchParams.get('body') ?? '';
  assert.equal(long.length, COMPOSE_BODY_MAX);
  assert.ok(long.endsWith('…'));
});

test('Recruitee is reached only through a plain subdomain and slug', () => {
  assert.equal(recruiteeEndpoint({ company: 'acme', offer: 'frontend-engineer' }), 'https://acme.recruitee.com/api/offers/frontend-engineer/candidates');
  assert.equal(recruiteeEndpoint({ company: 'evil.com/x', offer: 'a' }), null);
  assert.equal(recruiteeEndpoint({ company: 'acme', offer: '../admin' }), null);
  assert.equal(recruiteeEndpoint(undefined), null);
});

test('a reply keeps the subject and the reference chain', () => {
  assert.equal(replySubject('Application: Dev — Asha'), 'Re: Application: Dev — Asha');
  assert.equal(replySubject('RE: Offer'), 'RE: Offer');
  assert.equal(replySubject(''), 'Re: your message');
  assert.equal(replyReferences('<a@x> <b@x>', '<c@x>'), '<a@x> <b@x> <c@x>');
  assert.equal(replyReferences('', '<c@x>'), '<c@x>');
  assert.equal(replyReferences('<c@x> junk', '<c@x>'), '<c@x>');
  assert.equal(addDays('2026-10-27', 7), '2026-11-03');
});

test('the paste kit has every field a form asks, and skips the empty ones', () => {
  const kit = buildPasteKit({
    profile: { contact },
    application: { coverNote: { text: 'Hello team.', factIds: [] }, answers: [{ question: 'Why us?', answer: 'Because.' }, { question: 'Blank', answer: ' ' }] },
    spec: { salaryTarget: { amount: 3_000_000, currency: 'INR', period: 'year' }, salaryFloor: null, noticeDays: 30 },
  });
  assert.deepEqual(kit, [
    { label: 'Full name', value: 'Asha Rao' },
    { label: 'Email', value: 'asha@example.com' },
    { label: 'Phone', value: '+91 98765 43210' },
    { label: 'Location', value: 'Bengaluru' },
    { label: 'LinkedIn', value: 'https://www.linkedin.com/in/asha' },
    { label: 'GitHub', value: 'https://github.com/asha' },
    { label: 'Cover note', value: 'Hello team.' },
    { label: 'Why us?', value: 'Because.' },
    { label: 'Expected salary', value: 'INR 30,00,000 per year' },
    { label: 'Notice period', value: '30 days' },
  ]);
});

test('salary and notice come from the answers when the job asked for them', () => {
  const kit = buildPasteKit({
    profile: null,
    application: { coverNote: null, answers: [{ question: 'Expected CTC?', answer: '30 LPA' }, { question: 'Notice period?', answer: 'Immediate' }] },
    spec: { salaryTarget: null, salaryFloor: { amount: 100_000, currency: 'USD', period: 'year' }, noticeDays: 0 },
  });
  assert.deepEqual(kit.map((field) => field.label), ['Expected CTC?', 'Notice period?']);
  assert.equal(formatMoney({ amount: 145000, currency: 'USD', period: 'year' }), 'USD 145,000 per year');
  const noAnswers = buildPasteKit({ profile: null, application: null, spec: { salaryTarget: null, salaryFloor: null, noticeDays: 0 } });
  assert.deepEqual(noAnswers, [{ label: 'Notice period', value: 'Immediately available' }]);
});
