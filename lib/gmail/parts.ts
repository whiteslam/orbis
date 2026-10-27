/**
 * Reading a Gmail `format=full` message: its headers and its text and HTML
 * bodies. Pure (no IO), so the MIME walk is unit-tested.
 *
 * Gmail hands back the MIME tree already split into parts, each body base64url
 * encoded after transfer decoding, in the part's own charset. Attachments are
 * skipped, the first text/plain and text/html bodies win, and both are capped:
 * a newsletter's HTML can run to megabytes, and nothing that reads these needs
 * more than the first few hundred kilobytes.
 */

export type GmailHeader = { name?: string; value?: string };

export type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
};

export const TEXT_CAP = 50_000;
export const HTML_CAP = 300_000;
// base64 carries 3 bytes in 4 characters; this much encoded text covers the larger cap with room for multibyte text.
const ENCODED_CAP = Math.ceil((HTML_CAP * 4) / 3) * 2;
// A message nested deeper than this is malformed or hostile; real mail is a few levels at most.
const MAX_DEPTH = 12;

/** A header's value by name, case-insensitively; '' when absent. */
export function headerValue(headers: readonly GmailHeader[] | undefined, name: string): string {
  const lower = name.toLowerCase();
  return headers?.find((header) => header.name?.toLowerCase() === lower)?.value ?? '';
}

/** The charset a Content-Type names ("text/plain; charset=ISO-8859-1"), or utf-8. */
export function charsetOf(contentType: string): string {
  const match = /charset\s*=\s*"?([\w.:-]+)"?/i.exec(contentType);
  return match ? match[1].toLowerCase() : 'utf-8';
}

/** Bytes from base64url (or plain base64), ignoring padding and whitespace. Invalid input gives what decodes. */
export function base64UrlBytes(data: string): Uint8Array {
  const clean = data.replaceAll(/[^A-Za-z0-9\-_+/]/g, '').replaceAll('-', '+').replaceAll('_', '/');
  const usable = clean.slice(0, clean.length - (clean.length % 4 === 1 ? 1 : 0));
  const padded = usable.padEnd(Math.ceil(usable.length / 4) * 4, '=');
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.codePointAt(index) ?? 0;
    return bytes;
  } catch {
    return new Uint8Array();
  }
}

/** Decoded text in the given charset; an unknown charset is read as UTF-8, and bad bytes become U+FFFD. */
export function decodeBody(data: string, charset = 'utf-8'): string {
  const bytes = base64UrlBytes(data.slice(0, ENCODED_CAP));
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function isAttachment(part: GmailPart): boolean {
  if (part.filename) return true;
  return headerValue(part.headers, 'Content-Disposition').toLowerCase().startsWith('attachment');
}

type Bodies = { text: string; html: string };

function collect(part: GmailPart, found: Bodies, depth: number) {
  if (depth > MAX_DEPTH || isAttachment(part)) return;
  const type = (part.mimeType ?? '').toLowerCase();
  if (type.startsWith('multipart/') || part.parts?.length) {
    for (const child of part.parts ?? []) collect(child, found, depth + 1);
    return;
  }
  const data = part.body?.data;
  if (!data) return;
  const charset = charsetOf(headerValue(part.headers, 'Content-Type'));
  if (type === 'text/plain' && !found.text) found.text = decodeBody(data, charset).slice(0, TEXT_CAP);
  else if (type === 'text/html' && !found.html) found.html = decodeBody(data, charset).slice(0, HTML_CAP);
}

/**
 * The message's first plain-text and HTML bodies. Plain text is what gets read
 * (and classified); the HTML is kept for its links. Either may be ''.
 */
export function messageBodies(payload: GmailPart | undefined): Bodies {
  const found: Bodies = { text: '', html: '' };
  if (payload) collect(payload, found, 0);
  return found;
}
