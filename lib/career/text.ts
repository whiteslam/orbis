/**
 * Career: HTML and text helpers shared by the source parsers and job-alert
 * reading. Client-safe and pure.
 *
 * Feeds hand us HTML of every quality (escaped twice, cut mid-tag, Word
 * pastes), so everything here scans with indexOf rather than regexes that
 * could backtrack on a hostile page.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™',
  euro: '€', pound: '£', yen: '¥', cent: '¢', rupee: '₹', times: '×', deg: '°', laquo: '«', raquo: '»',
  eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à', ouml: 'ö', uuml: 'ü', auml: 'ä', szlig: 'ß', ccedil: 'ç',
  ntilde: 'ñ', zwnj: '', zwj: '', shy: '', ensp: ' ', emsp: ' ', thinsp: ' ',
};

/** The longest entity name worth looking for after an '&'. */
const MAX_ENTITY = 10;

function codePointText(code: number) {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return null;
  // Surrogates on their own aren't characters.
  if (code >= 0xd800 && code <= 0xdfff) return null;
  return String.fromCodePoint(code);
}

/** The character an entity body ("amp", "#39", "#x2F") stands for, or null. */
function entityText(body: string) {
  if (body.startsWith('#x') || body.startsWith('#X')) return codePointText(Number.parseInt(body.slice(2), 16));
  if (body.startsWith('#')) return codePointText(Number.parseInt(body.slice(1), 10));
  return NAMED_ENTITIES[body.toLowerCase()] ?? null;
}

/** Decodes named and numeric HTML entities once. Unknown ones are left as written. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  let out = '';
  let i = 0;
  while (i < text.length) {
    const amp = text.indexOf('&', i);
    if (amp === -1) break;
    out += text.slice(i, amp);
    const semi = text.indexOf(';', amp + 1);
    const decoded = semi !== -1 && semi - amp - 1 <= MAX_ENTITY ? entityText(text.slice(amp + 1, semi)) : null;
    if (decoded === null) {
      out += '&';
      i = amp + 1;
    } else {
      out += decoded;
      i = semi + 1;
    }
  }
  return out + text.slice(i);
}

/** Tags that end a line of text when they open or close. */
const BLOCK_TAGS = new Set([
  'p', 'div', 'br', 'li', 'ul', 'ol', 'tr', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article',
  'header', 'footer', 'blockquote', 'pre', 'hr', 'dd', 'dt', 'dl', 'td', 'th', 'tbody', 'thead', 'title',
]);

/** Elements whose content is never text. */
const SKIPPED = ['script', 'style', 'head', 'noscript', 'template'];

/** The lowercase tag name at the start of a tag body like "/p" or "a href=…". */
function tagName(body: string) {
  let start = body.startsWith('/') ? 1 : 0;
  while (body[start] === ' ') start += 1;
  let end = start;
  while (end < body.length && /[a-zA-Z0-9]/.test(body[end])) end += 1;
  return body.slice(start, end).toLowerCase();
}

/** Where the text after a skipped element begins: past its closing tag, or the end. */
function skipElement(html: string, from: number, name: string) {
  const close = html.toLowerCase().indexOf(`</${name}`, from);
  if (close === -1) return html.length;
  const end = html.indexOf('>', close);
  return end === -1 ? html.length : end + 1;
}

/** The end of a comment, or of the document when it never closes. */
function skipComment(html: string, from: number) {
  const end = html.indexOf('-->', from + 4);
  return end === -1 ? html.length : end + 3;
}

/**
 * HTML as plain text: block tags become line breaks, list items get a bullet,
 * every other tag is dropped and entities are decoded. Whitespace is tidied.
 */
export function htmlToText(html: string): string {
  let out = '';
  let i = 0;
  while (i < html.length) {
    const open = html.indexOf('<', i);
    if (open === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, open);
    if (html.startsWith('<!--', open)) {
      i = skipComment(html, open);
      continue;
    }
    const close = html.indexOf('>', open + 1);
    // A lone '<' ("a < b") is text, not a tag.
    if (close === -1 || !/[a-zA-Z/!]/.test(html[open + 1] ?? '')) {
      out += '<';
      i = open + 1;
      continue;
    }
    const body = html.slice(open + 1, close);
    const name = tagName(body);
    i = close + 1;
    if (!body.startsWith('/') && SKIPPED.includes(name)) {
      i = skipElement(html, i, name);
    } else if (name === 'li' && !body.startsWith('/')) {
      out += '\n• ';
    } else if (BLOCK_TAGS.has(name)) {
      out += '\n';
    }
  }
  return tidyLines(decodeEntities(out));
}

/** Every run of spaces, tabs and line breaks as one space, trimmed. */
export function collapseWhitespace(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(' ');
}

/**
 * Lines trimmed, inner spaces collapsed and empty lines dropped. Markup opens
 * and closes blocks back to back, so a blank line carries no meaning here.
 */
function tidyLines(text: string) {
  const lines: string[] = [];
  for (const raw of text.replaceAll('\r', '').split('\n')) {
    const line = collapseWhitespace(raw);
    if (line && line !== '•') lines.push(line);
  }
  return lines.join('\n');
}

/** At most `max` characters, cut at a word where one is near, with an ellipsis. */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, Math.max(0, max));
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  // Only back up to a space when it doesn't throw away much.
  const body = space > max * 0.8 ? cut.slice(0, space) : cut;
  return `${body.trimEnd()}…`;
}

/** The byte length of a UTF-8 sequence led by this byte, or 0 when it can't lead one. */
function utf8Length(lead: number) {
  if (lead >= 0xc2 && lead <= 0xdf) return 2;
  if (lead >= 0xe0 && lead <= 0xef) return 3;
  if (lead >= 0xf0 && lead <= 0xf4) return 4;
  return 0;
}

let decoder: TextDecoder | null = null;

/** The character a run of Latin-1 code units decodes to as UTF-8, or null when it isn't valid UTF-8. */
function decodeRun(text: string, at: number, length: number) {
  const bytes = new Uint8Array(length);
  for (let k = 0; k < length; k += 1) {
    const code = text.codePointAt(at + k) ?? 0;
    if (k > 0 && (code < 0x80 || code > 0xbf)) return null;
    bytes[k] = code;
  }
  decoder ??= new TextDecoder('utf-8', { fatal: true });
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Repairs UTF-8 that was decoded as Latin-1 somewhere upstream ("Weâ\u0080\u0099re"
 * back to "We’re"). Remote OK's API does this. Text that is already right is
 * left alone, because a real character after a lead byte fails the check.
 */
export function repairMojibake(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const length = utf8Length(text.codePointAt(i) ?? 0);
    const fixed = length ? decodeRun(text, i, length) : null;
    if (fixed === null) {
      out += text[i];
      i += 1;
    } else {
      out += fixed;
      i += length;
    }
  }
  return out;
}
