/**
 * The text of an uploaded DOCX resume, for the resume parser. Pure.
 *
 * A DOCX is a zip; its body is word/document.xml. Only the text runs (<w:t>)
 * matter, with a line per paragraph and the tabs and breaks inside them kept,
 * which is all the parser needs. Tables, text boxes and headers come through as
 * their own paragraphs, in document order.
 */
import { strFromU8, unzipSync } from 'fflate';
import { decodeEntities } from './text.ts';

const DOCUMENT = 'word/document.xml';
// A resume's document.xml is tens of kilobytes; anything past this isn't one.
const MAX_XML = 5_000_000;
const MAX_TEXT = 100_000;

/** The tag's name without its namespace and attributes: "<w:t xml:space=…>" → "t", "</w:p>" → "/p". */
function tagName(tag: string): string {
  let body = tag.slice(1, tag.endsWith('/>') ? -2 : -1).trim();
  const closing = body.startsWith('/');
  if (closing) body = body.slice(1);
  const space = body.search(/\s/);
  const qualified = space === -1 ? body : body.slice(0, space);
  const local = qualified.slice(qualified.indexOf(':') + 1);
  return closing ? `/${local}` : local;
}

/** What a tag adds to the text: a paragraph (closed, or empty) or a break ends a line, a tab is a tab. */
function tagText(name: string, empty: boolean): string {
  if (name === '/p' || (name === 'p' && empty) || name === 'br' || name === 'cr') return '\n';
  if (name === 'tab') return '\t';
  return '';
}

/** word/document.xml as plain text: one line per paragraph, entities decoded, blank runs collapsed. */
export function documentXmlText(xml: string): string {
  let out = '';
  let inText = false;
  let index = 0;
  while (index < xml.length) {
    const open = xml.indexOf('<', index);
    if (open === -1) break;
    if (inText) out += decodeEntities(xml.slice(index, open));
    const close = xml.indexOf('>', open);
    if (close === -1) break;
    const tag = xml.slice(open, close + 1);
    const name = tagName(tag);
    const empty = tag.endsWith('/>');
    if (name === 't') inText = !empty;
    else if (name === '/t') inText = false;
    else out += tagText(name, empty);
    index = close + 1;
  }
  return out
    .split('\n')
    .map((line) => line.replaceAll(/[  ]+/g, ' ').trim())
    .join('\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT);
}

/** The DOCX's text, or null when it isn't a readable DOCX. */
export function docxText(bytes: Uint8Array): string | null {
  let files: Record<string, Uint8Array>;
  // A real DOCX names word/document.xml once. A zip listing it many times (each
  // record pointing at the same compressed bytes) would be inflated once per
  // record, so only the first is read and a repeat refuses the file.
  let seen = 0;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        if (file.name !== DOCUMENT) return false;
        seen += 1;
        return seen === 1 && file.originalSize <= MAX_XML;
      },
    });
  } catch {
    return null;
  }
  if (seen !== 1) return null;
  const xml = files[DOCUMENT];
  if (!xml) return null;
  return documentXmlText(strFromU8(xml)) || null;
}

/** What kind of file the bytes are, by their signature rather than their name. */
export function resumeKind(bytes: Uint8Array): 'pdf' | 'docx' | null {
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'docx';
  return null;
}
