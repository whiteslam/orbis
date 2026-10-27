import { test } from 'vitest';
import assert from 'node:assert/strict';
import { base64UrlBytes, charsetOf, decodeBody, headerValue, messageBodies, TEXT_CAP, type GmailPart } from './parts.ts';

/** Gmail's encoding: base64url without padding. */
const encode = (text: string, encoding: 'utf8' | 'latin1' = 'utf8') => Buffer.from(text, encoding).toString('base64url');

test('base64url decodes with or without padding, and skips junk', () => {
  assert.equal(new TextDecoder().decode(base64UrlBytes(encode('hi?>'))), 'hi?>');
  assert.equal(new TextDecoder().decode(base64UrlBytes('aGk=')), 'hi');
  assert.equal(new TextDecoder().decode(base64UrlBytes('aG\nk')), 'hi');
  assert.equal(base64UrlBytes('').length, 0);
});

test('bodies decode in their own charset', () => {
  assert.equal(decodeBody(encode('Café ₹50')), 'Café ₹50');
  assert.equal(decodeBody(encode('Café', 'latin1'), 'iso-8859-1'), 'Café');
  // An unknown charset is read as UTF-8 rather than failing.
  assert.equal(decodeBody(encode('Café'), 'x-unknown'), 'Café');
});

test('charsets and headers are read case-insensitively', () => {
  assert.equal(charsetOf('text/plain; charset="ISO-8859-1"'), 'iso-8859-1');
  assert.equal(charsetOf('text/html'), 'utf-8');
  assert.equal(headerValue([{ name: 'message-id', value: '<a@b>' }], 'Message-ID'), '<a@b>');
  assert.equal(headerValue(undefined, 'From'), '');
});

test('a multipart message gives its plain text and keeps the HTML for links', () => {
  const payload: GmailPart = {
    mimeType: 'multipart/mixed',
    parts: [
      {
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=UTF-8' }], body: { data: encode('Hello there') } },
          { mimeType: 'text/html', body: { data: encode('<p>Hello <a href="https://x.io">there</a></p>') } },
        ],
      },
      { mimeType: 'text/plain', filename: 'notes.txt', body: { attachmentId: 'att1' } },
      { mimeType: 'text/plain', headers: [{ name: 'Content-Disposition', value: 'attachment; filename=a.txt' }], body: { data: encode('attached') } },
    ],
  };
  assert.deepEqual(messageBodies(payload), { text: 'Hello there', html: '<p>Hello <a href="https://x.io">there</a></p>' });
});

test('an HTML-only or a single-part message still reads', () => {
  assert.deepEqual(messageBodies({ mimeType: 'text/html', body: { data: encode('<b>Hi</b>') } }), { text: '', html: '<b>Hi</b>' });
  assert.deepEqual(messageBodies({ mimeType: 'text/plain', body: { data: encode('Just text') } }), { text: 'Just text', html: '' });
  assert.deepEqual(messageBodies(undefined), { text: '', html: '' });
});

test('bodies are capped', () => {
  const long = 'a'.repeat(TEXT_CAP + 500);
  assert.equal(messageBodies({ mimeType: 'text/plain', body: { data: encode(long) } }).text.length, TEXT_CAP);
});

test('absurd nesting is not followed forever', () => {
  let part: GmailPart = { mimeType: 'text/plain', body: { data: encode('deep') } };
  for (let level = 0; level < 40; level += 1) part = { mimeType: 'multipart/mixed', parts: [part] };
  assert.deepEqual(messageBodies(part), { text: '', html: '' });
});
