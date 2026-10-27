import { test } from 'vitest';
import assert from 'node:assert/strict';
import { base64, base64url, buildMessage, buildRawMessage, encodeWord, formatAddress } from './mime.ts';

const decodeRaw = (raw: string) => Buffer.from(raw, 'base64url').toString('utf8');
const headerBlock = (message: string) => message.slice(0, message.indexOf('\r\n\r\n'));
const unfold = (headers: string) => headers.replaceAll('\r\n ', ' ');

/** Splits a multipart body on its boundary into [headers, body] pairs. */
function parts(entity: string) {
  const boundary = /boundary="([^"]+)"/.exec(entity)?.[1];
  assert.ok(boundary, 'no boundary');
  const body = entity.slice(entity.indexOf('\r\n\r\n') + 4);
  assert.ok(body.trimEnd().endsWith(`--${boundary}--`), 'no closing boundary');
  return body.split(`--${boundary}`).slice(1, -1).map((section) => section.replace(/^\r\n/, '').replace(/\r\n$/, ''));
}

const bodyText = (part: string) => Buffer.from(part.slice(part.indexOf('\r\n\r\n') + 4).replaceAll('\r\n', ''), 'base64');

test('base64 matches the platform encoder', () => {
  for (const sample of ['', 'a', 'ab', 'abc', 'hello world', '₹ and ✓']) {
    const bytes = new TextEncoder().encode(sample);
    assert.equal(base64(bytes), Buffer.from(bytes).toString('base64'));
    assert.equal(base64url(bytes), Buffer.from(bytes).toString('base64url'));
  }
});

test('a plain message: ASCII, CRLF only, wrapped at 76', () => {
  const message = buildMessage({ from: 'Asha Rao <asha@example.com>', to: 'jobs@acme.io', subject: 'Frontend engineer', text: 'Hello\n'.repeat(40) });
  assert.ok(/^[\x20-\x7e\r\n]*$/.test(message), 'not 7-bit');
  assert.ok(!/[^\r]\n/.test(message), 'bare LF');
  for (const line of message.split('\r\n')) assert.ok(line.length <= 78, line);
  const headers = headerBlock(message);
  assert.match(headers, /^From: Asha Rao <asha@example.com>\r\nTo: jobs@acme.io\r\nSubject: Frontend engineer\r\n/);
  assert.match(headers, /MIME-Version: 1\.0/);
  assert.match(headers, /Content-Type: text\/plain; charset="UTF-8"/);
  assert.equal(bodyText(message).toString('utf8'), 'Hello\n'.repeat(40));
});

test('non-ASCII subjects and names become encoded-words that decode back', () => {
  const subject = 'Application — Senior Engineer (₹ बेंगलुरु) '.repeat(3);
  const encoded = encodeWord(subject);
  const words = encoded.split('\r\n ');
  for (const word of words) {
    assert.ok(word.length <= 75, word);
    assert.match(word, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
  }
  const decoded = words.map((word) => Buffer.from(word.slice(10, -2), 'base64').toString('utf8')).join('');
  assert.equal(decoded, subject);
  assert.equal(encodeWord('Plain'), 'Plain');
  assert.match(formatAddress('José Ñúñez <jose@example.com>'), /^=\?UTF-8\?B\?.+\?= <jose@example.com>$/);
  assert.equal(formatAddress('Rao, Asha <asha@example.com>'), '"Rao, Asha" <asha@example.com>');
  assert.equal(formatAddress('"Asha" <asha@example.com>'), 'Asha <asha@example.com>');
});

test('header injection is refused', () => {
  const base = { from: 'a@example.com', to: 'b@example.com', subject: 'Hi', text: 'x' };
  assert.throws(() => buildRawMessage({ ...base, subject: 'Hi\r\nBcc: evil@example.com' }), /line break/);
  assert.throws(() => buildRawMessage({ ...base, to: 'b@example.com\nBcc: evil@example.com' }), /line break/);
  assert.throws(() => buildRawMessage({ ...base, inReplyTo: '<a@b>\r\nX: y' }), /line break/);
  assert.throws(() => buildRawMessage({ ...base, attachments: [{ filename: 'a\r\n.pdf', contentType: 'application/pdf', data: new Uint8Array() }] }), /line break/);
  assert.throws(() => buildRawMessage({ ...base, attachments: [{ filename: 'a.pdf', contentType: 'application/pdf; x=1', data: new Uint8Array() }] }), /not valid/);
  assert.throws(() => buildRawMessage({ ...base, to: 'not an address' }), /not valid/);
});

test('html and attachments: mixed around alternative, every byte intact', () => {
  const pdf = new Uint8Array(3000).map((_, index) => (index * 37) % 256);
  const raw = buildRawMessage({
    from: 'asha@example.com', to: ['jobs@acme.io', 'Hiring Team <hiring@acme.io>'], subject: 'Re: Frontend engineer',
    text: 'Plain ✓', html: '<p>Rich ✓</p>', inReplyTo: '<abc@mail.gmail.com>', references: '<one@x> <abc@mail.gmail.com>',
    attachments: [{ filename: 'Résumé Asha.pdf', contentType: 'application/pdf', data: pdf }],
  });
  assert.ok(/^[A-Za-z0-9_-]+$/.test(raw), 'not base64url');
  const message = decodeRaw(raw);
  const headers = unfold(headerBlock(message));
  assert.match(headers, /To: jobs@acme.io, Hiring Team <hiring@acme.io>/);
  assert.match(headers, /In-Reply-To: <abc@mail.gmail.com>/);
  assert.match(headers, /References: <one@x> <abc@mail.gmail.com>/);
  assert.match(headers, /Content-Type: multipart\/mixed; boundary="orbis=_[0-9a-f]+"/);

  const [content, attachment, extra] = parts(message);
  assert.equal(extra, undefined);
  assert.match(content, /^Content-Type: multipart\/alternative/);
  const [plain, html] = parts(content);
  assert.equal(bodyText(plain).toString('utf8'), 'Plain ✓');
  assert.match(html, /text\/html/);
  assert.equal(bodyText(html).toString('utf8'), '<p>Rich ✓</p>');

  const attachmentHeaders = unfold(headerBlock(attachment));
  assert.match(attachmentHeaders, /Content-Type: application\/pdf; name="R_sum_ Asha.pdf"/);
  assert.match(attachmentHeaders, /filename\*=UTF-8''R%C3%A9sum%C3%A9%20Asha\.pdf/);
  assert.deepEqual(new Uint8Array(bodyText(attachment)), pdf);
  for (const line of message.split('\r\n')) assert.ok(line.length <= 78, line);
});

test('html alone is multipart/alternative; boundaries differ per part', () => {
  const message = buildMessage({ from: 'a@example.com', to: 'b@example.com', subject: 'S', text: 't', html: '<b>h</b>', attachments: [] });
  assert.match(unfold(headerBlock(message)), /multipart\/alternative; boundary=/);
  const nested = buildMessage({ from: 'a@example.com', to: 'b@example.com', subject: 'S', text: 't', html: 'h', attachments: [{ filename: 'a.txt', contentType: 'text/plain', data: new Uint8Array([104]) }] });
  const boundaries = [...nested.matchAll(/boundary="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(boundaries.length, 2);
  assert.notEqual(boundaries[0], boundaries[1]);
});

test('an Orbis reference rides in its own header, and only a safe one', () => {
  const message = buildMessage({ from: 'a@b.com', to: 'c@d.com', subject: 'Hi', text: 'x', orbisRef: 'app-1234abcd' });
  assert.match(message, /\r\nX-Orbis-Ref: app-1234abcd\r\n/);
  assert.throws(() => buildMessage({ from: 'a@b.com', to: 'c@d.com', subject: 'Hi', text: 'x', orbisRef: 'bad\r\nBcc: e@f.com' }));
  assert.doesNotMatch(buildMessage({ from: 'a@b.com', to: 'c@d.com', subject: 'Hi', text: 'x' }), /X-Orbis-Ref/);
});
