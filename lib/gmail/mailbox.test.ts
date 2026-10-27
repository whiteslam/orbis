import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mailboxOf } from './mailbox.ts';
import { senderAddress } from './important-filter.ts';
import { domainOf, linkReply, replyCandidate, type OpenApp } from '../career/mail.ts';
import { alertSenderFor } from '../career/alerts.ts';
import { formatAddress } from './mime.ts';

test('ordinary headers read as before', () => {
  assert.equal(mailboxOf('Jane Doe <Jane@Acme.com>'), 'jane@acme.com');
  assert.equal(mailboxOf('"Doe, Jane" <jane@acme.co.uk>'), 'jane@acme.co.uk');
  assert.equal(mailboxOf('jane@acme.io'), 'jane@acme.io');
  assert.equal(mailboxOf('  Jane@Acme.io  '), 'jane@acme.io');
  assert.equal(mailboxOf('Asha <> <asha@example.com>'), 'asha@example.com');
  assert.equal(mailboxOf('Acme (HR team) <hr@acme.com>'), 'hr@acme.com');
});

test('a comment or a quoted name can’t supply the address', () => {
  assert.equal(mailboxOf('a@attacker.example (<hr@acme.com>)'), 'a@attacker.example');
  assert.equal(mailboxOf('<a@attacker.example> (<hr@acme.com>)'), 'a@attacker.example');
  assert.equal(mailboxOf('"Acme <hr@acme.com>" <a@attacker.example>'), 'a@attacker.example');
  assert.equal(mailboxOf('a@attacker.example (note (nested <hr@acme.com>) here)'), 'a@attacker.example');
  assert.equal(mailboxOf(String.raw`"Acme \" <hr@acme.com>" <a@attacker.example>`), 'a@attacker.example');
});

test('every parser agrees on the sender', () => {
  const headers = [
    'a@attacker.example (<hr@acme.com>)',
    '<a@attacker.example> (<hr@acme.com>)',
    '"Acme <hr@acme.com>" <a@attacker.example>',
  ];
  for (const header of headers) {
    assert.equal(senderAddress(header), 'a@attacker.example', header);
    assert.equal(domainOf(header), 'attacker.example', header);
  }
  assert.equal(domainOf('Name <x@y.com>'), 'y.com');
  assert.equal(senderAddress('Name <x@y.com>'), 'x@y.com');
  // A quoted name with no address after it names no domain.
  assert.equal(domainOf('"Acme <hr@acme.com>"'), null);
  // An alert sender's address in a comment doesn't make the mail an alert.
  assert.equal(alertSenderFor('a@attacker.example (<jobalerts-noreply@linkedin.com>)'), null);
  assert.equal(alertSenderFor('LinkedIn <jobalerts-noreply@linkedin.com>')?.key, 'linkedin');
});

test('a comment claiming the company domain doesn’t link a reply', () => {
  const apps: OpenApp[] = [{ id: 'app1', company: 'Acme', domains: ['acme.com'], threadId: null }];
  for (const from of ['a@attacker.example (<hr@acme.com>)', '<a@attacker.example> (<hr@acme.com>)', '"Acme <hr@acme.com>" <a@attacker.example>']) {
    assert.equal(replyCandidate({ threadId: 't1', from, subject: 'x', snippet: 'x' }, apps, new Set()), null, from);
    assert.equal(linkReply({ company: 'Acme' }, { threadId: 't1', from }, apps), null, from);
  }
  assert.deepEqual(replyCandidate({ threadId: 't1', from: 'HR <hr@acme.com>', subject: 'x', snippet: 'x' }, apps, new Set()), { applicationId: 'app1', reason: 'domain' });
});

test('a header with two addresses, or an address in its name, names no sender', () => {
  const headers = [
    'HR <hr@acme.com> <a@attacker.example>',
    'hr@acme.com <a@attacker.example>',
    'HR hr@acme.com <a@attacker.example>',
    '<a@attacker.example> hr@acme.com',
    'HR <hr@acme.com <a@attacker.example>>',
    'HR <hr@acme.com> <a@attacker.example',
    'LinkedIn <jobalerts-noreply@linkedin.com> <a@attacker.example>',
  ];
  const apps: OpenApp[] = [{ id: 'app1', company: 'Acme', domains: ['acme.com'], threadId: null }];
  for (const header of headers) {
    assert.equal(mailboxOf(header), null, header);
    assert.equal(senderAddress(header), null, header);
    assert.equal(domainOf(header), null, header);
    assert.equal(alertSenderFor(header), null, header);
    assert.equal(replyCandidate({ threadId: 't1', from: header, subject: 'x', snippet: 'x' }, apps, new Set()), null, header);
    assert.equal(linkReply({ company: 'Acme' }, { threadId: 't1', from: header }, apps), null, header);
    // Nor can one be sent to: what's sent is always what was shown.
    assert.throws(() => formatAddress(header), header);
  }
  // A quoted name may hold an "@"; a comment or a second "<" can't reach a recipient.
  assert.equal(mailboxOf('"hr@acme.com" <a@attacker.example>'), 'a@attacker.example');
  assert.equal(formatAddress('"hr@acme.com" <a@attacker.example>'), '"hr@acme.com" <a@attacker.example>');
  assert.throws(() => formatAddress('a@attacker.example (<hr@acme.com>)'));
  assert.throws(() => formatAddress('"Acme <hr@acme.com>" <a@attacker.example>'));
  assert.equal(formatAddress('Jane Doe <jane@acme.com>'), 'Jane Doe <jane@acme.com>');
});
