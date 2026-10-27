// ExcelJS expands some A1 ranges in a worksheet's XML into one object per cell while it loads: every
// <mergeCell ref> and every <dataValidation sqref>. That work grows with the range's area, not the file's size,
// so a few hundred bytes can ask for billions of cells. These helpers measure those ranges from the raw XML
// before ExcelJS sees it. (Conditional formatting sqref ranges are stored as text, not expanded, so they are
// left alone.) Defined names in xl/workbook.xml and <col> spans in a worksheet are expanded the same way.

const SHEET_ROWS = 1_048_576;
const SHEET_COLUMNS = 16_384;

const REF_SIDE = /^\$?([A-Za-z]{1,3})?\$?(\d{1,7})?$/;

function columnNumber(letters: string) {
  let column = 0;
  for (const letter of letters.toUpperCase()) column = column * 26 + (letter.charCodeAt(0) - 64);
  return column;
}

/** One side of a range: its column and row, either of which may be missing (A:A, 1:1). Null when malformed. */
function refSide(side: string): { column: number | null; row: number | null } | null {
  const match = REF_SIDE.exec(side);
  if (!match || (!match[1] && !match[2])) return null;
  return { column: match[1] ? columnNumber(match[1]) : null, row: match[2] ? Number(match[2]) : null };
}

/**
 * The number of cells one A1 reference covers: A1, $A$1:$B$2, whole columns (A:C) and whole rows (1:3).
 * Anything it cannot read counts as the whole sheet, so a malformed reference is refused rather than trusted.
 */
export function rangeArea(ref: string): number {
  const sides = ref.trim().split(':');
  if (sides.length > 2) return SHEET_ROWS * SHEET_COLUMNS;
  const [start, end] = sides.map(refSide);
  if (!start || (sides.length === 2 && !end)) return SHEET_ROWS * SHEET_COLUMNS;
  const last = end ?? start;
  // Both sides must be the same shape: two cells, two columns or two rows.
  if ((start.column === null) !== (last.column === null) || (start.row === null) !== (last.row === null)) {
    return SHEET_ROWS * SHEET_COLUMNS;
  }
  const columns = start.column === null || last.column === null ? SHEET_COLUMNS : Math.abs(last.column - start.column) + 1;
  const rows = start.row === null || last.row === null ? SHEET_ROWS : Math.abs(last.row - start.row) + 1;
  return columns * rows;
}

export type RangeCells = { largest: number; total: number };

type Attribute = [name: string, value: string];
type StartTag = { name: string; attributes: Attribute[]; end: number; selfClosing: boolean };

const NAME_CHAR = /[\w.:-]/;
const SPACE = /\s/;

function isQuote(char: string | undefined) {
  return char === '"' || char === "'";
}

/** The attributes between a tag's name and its closing `>`, read once from left to right. */
function tagAttributes(source: string): Attribute[] {
  const attributes: Attribute[] = [];
  let index = 0;
  while (index < source.length) {
    if (isQuote(source[index])) {
      // A stray quoted value with no name in front of it: skip it whole.
      const close = source.indexOf(source[index], index + 1);
      if (close === -1) break;
      index = close + 1;
      continue;
    }
    if (!NAME_CHAR.test(source[index])) {
      index += 1;
      continue;
    }
    const nameStart = index;
    while (index < source.length && NAME_CHAR.test(source[index])) index += 1;
    const name = source.slice(nameStart, index);
    while (index < source.length && SPACE.test(source[index])) index += 1;
    if (source[index] !== '=') continue;
    index += 1;
    while (index < source.length && SPACE.test(source[index])) index += 1;
    if (!isQuote(source[index])) continue;
    const close = source.indexOf(source[index], index + 1);
    if (close === -1) break;
    attributes.push([name, source.slice(index + 1, close)]);
    index = close + 1;
  }
  return attributes;
}

/**
 * Every start tag named one of `names` (with or without a namespace prefix), found in one left-to-right pass.
 * Quoted attribute values may hold `>`. A tag still open at the end of the input ends the scan, and a `<` inside a
 * tag abandons that tag and resumes from the `<`, so no character is read more than a fixed number of times
 * however broken the XML is. (A backtracking regex here was quadratic on unterminated tags.)
 */
function* startTags(xml: string, names: ReadonlySet<string>): Generator<StartTag> {
  let position = 0;
  while (position < xml.length) {
    const open = xml.indexOf('<', position);
    if (open === -1) return;
    let nameEnd = open + 1;
    while (nameEnd < xml.length && NAME_CHAR.test(xml[nameEnd])) nameEnd += 1;
    position = nameEnd;
    const qualified = xml.slice(open + 1, nameEnd);
    const name = qualified.slice(qualified.lastIndexOf(':') + 1);
    const next = xml[nameEnd] ?? '';
    if (!names.has(name) || qualified.split(':').length > 2 || (next !== '>' && next !== '/' && !SPACE.test(next))) continue;

    let index = nameEnd;
    while (index < xml.length && xml[index] !== '>' && xml[index] !== '<') {
      if (isQuote(xml[index])) {
        const close = xml.indexOf(xml[index], index + 1);
        if (close === -1) return;
        index = close + 1;
      } else {
        index += 1;
      }
    }
    if (index >= xml.length) return;
    position = index;
    if (xml[index] === '<') continue;
    const selfClosing = xml[index - 1] === '/';
    yield { name, attributes: tagAttributes(xml.slice(nameEnd, index)), end: index + 1, selfClosing };
    position = index + 1;
  }
}

function addArea(cells: RangeCells, area: number) {
  cells.largest = Math.max(cells.largest, area);
  cells.total += area;
}

const EXPANDED_TAGS: ReadonlySet<string> = new Set(['mergeCell', 'dataValidation']);

/** The largest single range and the total cells across every merge and data validation range in a sheet's XML. */
export function expandedRangeCells(xml: string): RangeCells {
  const cells: RangeCells = { largest: 0, total: 0 };
  for (const tag of startTags(xml, EXPANDED_TAGS)) {
    const wanted = tag.name === 'mergeCell' ? 'ref' : 'sqref';
    for (const [name, value] of tag.attributes) {
      if (name !== wanted) continue;
      for (const ref of value.split(/\s+/).filter(Boolean)) addArea(cells, rangeArea(ref));
    }
  }
  return cells;
}

const COLUMN_TAG: ReadonlySet<string> = new Set(['col']);
const COLUMN_INDEX = /^\d{1,5}$/;

/**
 * The highest column a sheet's `<col min max>` spans reach. ExcelJS makes one Column object for every index up to
 * the largest max (filling any gap below a min too) with no bound of its own, so callers keep this within Excel's
 * 16,384 columns. A span that is not two whole numbers with 1 <= min <= max counts as unbounded.
 */
export function declaredColumnExtent(xml: string): number {
  let highest = 0;
  for (const tag of startTags(xml, COLUMN_TAG)) {
    const attributes = new Map(tag.attributes);
    const min = attributes.get('min') ?? '';
    const max = attributes.get('max') ?? '';
    if (!COLUMN_INDEX.test(min) || !COLUMN_INDEX.test(max)) return Infinity;
    const low = Number(min);
    const high = Number(max);
    if (low < 1 || low > high) return Infinity;
    highest = Math.max(highest, high);
  }
  return highest;
}

const XML_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function characterReference(entity: string): string | undefined {
  const code = /^#\d{1,7}$/.test(entity) ? Number(entity.slice(1)) : /^#x[\da-fA-F]{1,6}$/.test(entity) ? Number.parseInt(entity.slice(2), 16) : NaN;
  return Number.isInteger(code) && code <= 0x10ffff ? String.fromCodePoint(code) : undefined;
}

/** XML character data with its entities decoded, or null when it holds one this cannot read. */
function decodeXmlText(text: string): string | null {
  const parts: string[] = [];
  let position = 0;
  for (let amp = text.indexOf('&'); amp !== -1; amp = text.indexOf('&', position)) {
    const semi = text.indexOf(';', amp);
    if (semi === -1 || semi - amp > 10) return null;
    const entity = text.slice(amp + 1, semi);
    const char = XML_ENTITIES[entity] ?? characterReference(entity);
    if (char === undefined) return null;
    parts.push(text.slice(position, amp), char);
    position = semi + 1;
  }
  parts.push(text.slice(position));
  return parts.join('');
}

/** `text` split at characters matching `separator`, except inside single-quoted sheet names ('' is an escaped quote). */
function splitOutsideQuotes(text: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let quoted = false;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "'") quoted = !quoted;
    else if (!quoted && separator.test(text[index])) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.filter(Boolean);
}

/** The reference after a defined-name token's plain or quoted sheet name, or null when the token is not that shape. */
function definedNameReference(token: string): string | null {
  if (!token.startsWith("'")) {
    const bang = token.indexOf('!');
    if (bang === -1) return token;
    // ExcelJS reads an unquoted sheet name only up to its first `'`, `^`, space or `!`.
    return /['^ ]/.test(token.slice(0, bang)) ? null : token.slice(bang + 1);
  }
  for (let index = 1; ; ) {
    const quote = token.indexOf("'", index);
    if (quote === -1) return null;
    if (token[quote + 1] === "'") {
      index = quote + 2;
      continue;
    }
    return token[quote + 1] === '!' ? token.slice(quote + 2) : null;
  }
}

/**
 * The cells one defined-name token covers: an A1 range with an optional sheet name in front and any closing
 * brackets of a surrounding formula after it (ExcelJS stops reading an address at them). Anything else, including
 * a second `!`, counts as the whole sheet.
 */
function definedNameTokenArea(token: string): number {
  const reference = definedNameReference(token);
  if (reference === null || reference.includes('!')) return SHEET_ROWS * SHEET_COLUMNS;
  let end = reference.length;
  while (end > 0 && reference[end - 1] === ')') end -= 1;
  return rangeArea(reference.slice(0, end));
}

const DEFINED_NAME_TAG: ReadonlySet<string> = new Set(['definedName']);
const DEFINED_NAME_CLOSE = /^<\/(?:[\w.-]+:)?definedName[\s>]/;
// ExcelJS expands a comma-separated part of a defined name into one object per cell when the text after the part's
// last `!` contains this (unanchored) pattern: see the DefinedNames model setter in exceljs/lib/doc/defined-names.js.
const EXPANDED_DEFINED_NAME = /\$\w+\$\d/;

/**
 * The largest single range and the total cells across the `<definedName>` values in xl/workbook.xml that ExcelJS
 * would expand cell by cell. Every space-separated token of such a part must be a readable A1 reference (with an
 * optional sheet name), and anything else counts as the whole sheet, as does a name whose text cannot be read.
 */
export function definedNameRangeCells(xml: string): RangeCells {
  const cells: RangeCells = { largest: 0, total: 0 };
  for (const tag of startTags(xml, DEFINED_NAME_TAG)) {
    if (tag.selfClosing) continue;
    const textEnd = xml.indexOf('<', tag.end);
    const text = textEnd === -1 ? null : decodeXmlText(xml.slice(tag.end, textEnd));
    if (text === null || !DEFINED_NAME_CLOSE.test(xml.slice(textEnd, textEnd + 64))) {
      addArea(cells, SHEET_ROWS * SHEET_COLUMNS);
      continue;
    }
    for (const part of splitOutsideQuotes(text, /,/)) {
      if (!EXPANDED_DEFINED_NAME.test(part.slice(part.lastIndexOf('!') + 1))) continue;
      for (const token of splitOutsideQuotes(part, /\s/)) addArea(cells, definedNameTokenArea(token));
    }
  }
  return cells;
}
