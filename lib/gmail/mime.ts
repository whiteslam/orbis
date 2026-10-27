/**
 * An RFC 5322 / MIME message for Gmail's users.messages.send, as the base64url
 * `raw` it expects. Pure (no IO), so the structure is unit-tested.
 *
 * Everything leaves as 7-bit ASCII: non-ASCII header text becomes RFC 2047
 * encoded-words, bodies and attachments are base64 wrapped at 76, and lines end
 * in CRLF. A header value with a line break is refused outright, because that is
 * how a crafted subject or address would smuggle in a Bcc.
 */

export type MimeAttachment = { filename: string; contentType: string; data: Uint8Array };

export type RawMessageInput = {
  from: string;
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  /** The Message-ID being answered, `<…>`, to stay in the thread. */
  inReplyTo?: string;
  references?: string;
  attachments?: MimeAttachment[];
};

const CRLF = '\r\n';
const LINE = 76;

// ─── Base64 ──────────────────────────────────────────────────────────────

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 of bytes, without Buffer, so it runs anywhere. */
export function base64(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0;
    out += ALPHABET[a >> 2] + ALPHABET[((a & 3) << 4) | (b >> 4)];
    out += index + 1 < bytes.length ? ALPHABET[((b & 15) << 2) | (c >> 6)] : '=';
    out += index + 2 < bytes.length ? ALPHABET[c & 63] : '=';
  }
  return out;
}

/** URL-safe base64 without padding, as Gmail's `raw` field takes it. */
export function base64url(bytes: Uint8Array): string {
  const encoded = base64(bytes).replaceAll('+', '-').replaceAll('/', '_');
  const padding = encoded.endsWith('==') ? 2 : Number(encoded.endsWith('='));
  return encoded.slice(0, encoded.length - padding);
}

const utf8 = (text: string) => new TextEncoder().encode(text);

function wrapped(bytes: Uint8Array) {
  const encoded = base64(bytes);
  const lines: string[] = [];
  for (let index = 0; index < encoded.length; index += LINE) lines.push(encoded.slice(index, index + LINE));
  return lines.join(CRLF);
}

// ─── Headers ─────────────────────────────────────────────────────────────

/** Refuses CR or LF in a header value: the header-injection guard. */
function safe(name: string, value: string) {
  if (value.includes('\r') || value.includes('\n')) throw new Error(`The ${name} header can't contain a line break.`);
  return value;
}

// Printable ASCII plus space and tab.
const isAscii = (text: string) => /^[\x20-\x7e\t]*$/.test(text);

// "=?UTF-8?B?" + "?=" is 12 characters; 45 bytes make 60 base64 characters, so each word stays within 75.
const WORD_BYTES = 45;

/** RFC 2047 encoded-words for non-ASCII text, split on character boundaries and folded. ASCII passes through. */
export function encodeWord(text: string): string {
  if (isAscii(text)) return text;
  const words: string[] = [];
  let chunk: number[] = [];
  for (const char of text) {
    const bytes = utf8(char);
    if (chunk.length + bytes.length > WORD_BYTES) {
      words.push(`=?UTF-8?B?${base64(Uint8Array.from(chunk))}?=`);
      chunk = [];
    }
    chunk.push(...bytes);
  }
  if (chunk.length) words.push(`=?UTF-8?B?${base64(Uint8Array.from(chunk))}?=`);
  return words.join(`${CRLF} `);
}

const SPECIALS = /[()<>[\]:;@\\,."]/;

/** One address, "Name <a@b.com>" or "a@b.com", with the display name encoded or quoted as it needs. */
export function formatAddress(input: string): string {
  const value = safe('address', input).trim();
  const open = value.lastIndexOf('<');
  const close = value.lastIndexOf('>');
  const address = (open >= 0 && close > open ? value.slice(open + 1, close) : value).trim();
  // Internationalised addresses need SMTPUTF8, which this builder doesn't speak.
  if (!isAscii(address) || !/^[^\s@<>()",;]+@[^\s@<>()",;]+$/.test(address)) throw new Error('That email address is not valid.');
  if (open < 0) return address;
  const name = value.slice(0, open).trim().replace(/^"(.*)"$/, '$1');
  if (!name) return address;
  if (!isAscii(name)) return `${encodeWord(name)} <${address}>`;
  return SPECIALS.test(name) ? `"${name.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}" <${address}>` : `${name} <${address}>`;
}

/** Message ids, one per folded line so a long thread stays under the line limit. */
function foldIds(name: string, value: string) {
  return safe(name, value).trim().split(/\s+/).filter(Boolean).join(`${CRLF} `);
}

// ─── Parts ───────────────────────────────────────────────────────────────

type Part = { headers: string[]; body: string };

/** A boundary that can't occur in base64 content ('=_' never does) and differs every time. */
export function makeBoundary(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return `orbis=_${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function textPart(subtype: 'plain' | 'html', content: string): Part {
  return {
    headers: [`Content-Type: text/${subtype}; charset="UTF-8"`, 'Content-Transfer-Encoding: base64'],
    body: wrapped(utf8(content)),
  };
}

function multipart(subtype: 'mixed' | 'alternative', parts: Part[]): Part {
  const boundary = makeBoundary();
  const sections = parts.map((part) => `--${boundary}${CRLF}${part.headers.join(CRLF)}${CRLF}${CRLF}${part.body}`);
  return {
    headers: [`Content-Type: multipart/${subtype};${CRLF} boundary="${boundary}"`],
    body: `${sections.join(CRLF)}${CRLF}--${boundary}--`,
  };
}

const MEDIA_TYPE = /^[a-z0-9][\w.+-]*\/[a-z0-9][\w.+-]*$/i;

/** A filename as a quoted ASCII parameter, plus RFC 2231 `filename*` when it has non-ASCII letters. */
function fileParams(filename: string) {
  const clean = safe('filename', filename).replaceAll('"', "'").replaceAll('\\', '_').trim() || 'attachment';
  let ascii = '';
  for (const char of clean) ascii += isAscii(char) ? char : '_';
  if (isAscii(clean)) return { name: `name="${ascii}"`, filename: `filename="${ascii}"` };
  const encoded = encodeURIComponent(clean).replaceAll("'", '%27').replaceAll('(', '%28').replaceAll(')', '%29').replaceAll('*', '%2A');
  return { name: `name="${ascii}"`, filename: `filename="${ascii}";${CRLF} filename*=UTF-8''${encoded}` };
}

function attachmentPart(attachment: MimeAttachment): Part {
  const type = safe('content type', attachment.contentType).trim();
  if (!MEDIA_TYPE.test(type)) throw new Error('That attachment type is not valid.');
  const params = fileParams(attachment.filename);
  return {
    headers: [
      `Content-Type: ${type};${CRLF} ${params.name}`,
      `Content-Disposition: attachment;${CRLF} ${params.filename}`,
      'Content-Transfer-Encoding: base64',
    ],
    body: wrapped(attachment.data),
  };
}

function bodyOf(input: RawMessageInput): Part {
  const text = textPart('plain', input.text);
  const content = input.html === undefined ? text : multipart('alternative', [text, textPart('html', input.html)]);
  const attachments = input.attachments ?? [];
  return attachments.length ? multipart('mixed', [content, ...attachments.map(attachmentPart)]) : content;
}

/** The whole message, as text with CRLF line endings. */
export function buildMessage(input: RawMessageInput): string {
  const recipients = (Array.isArray(input.to) ? input.to : [input.to]).map(formatAddress);
  if (!recipients.length) throw new Error('A message needs a recipient.');
  const headers = [
    `From: ${formatAddress(input.from)}`,
    `To: ${recipients.join(`,${CRLF} `)}`,
    `Subject: ${encodeWord(safe('subject', input.subject))}`,
  ];
  if (input.inReplyTo) headers.push(`In-Reply-To: ${foldIds('In-Reply-To', input.inReplyTo)}`);
  if (input.references) headers.push(`References: ${foldIds('References', input.references)}`);
  headers.push('MIME-Version: 1.0');
  const body = bodyOf(input);
  return `${[...headers, ...body.headers].join(CRLF)}${CRLF}${CRLF}${body.body}${CRLF}`;
}

/** The base64url `raw` for users.messages.send. */
export function buildRawMessage(input: RawMessageInput): string {
  return base64url(utf8(buildMessage(input)));
}
