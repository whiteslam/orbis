// ExcelJS expands some A1 ranges in a worksheet's XML into one object per cell while it loads: every
// <mergeCell ref> and every <dataValidation sqref>. That work grows with the range's area, not the file's size,
// so a few hundred bytes can ask for billions of cells. These helpers measure those ranges from the raw XML
// before ExcelJS sees it. (Conditional formatting sqref ranges are stored as text, not expanded, so they are
// left alone.)

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

const EXPANDED_TAGS = /<(?:[\w.-]+:)?(mergeCell|dataValidation)(?=[\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** The largest single range and the total cells across every merge and data validation range in a sheet's XML. */
export function expandedRangeCells(xml: string): RangeCells {
  const cells: RangeCells = { largest: 0, total: 0 };
  for (const [, tag, attributes] of xml.matchAll(EXPANDED_TAGS)) {
    const wanted = tag === 'mergeCell' ? 'ref' : 'sqref';
    for (const [, name, doubleQuoted, singleQuoted] of attributes.matchAll(ATTRIBUTE)) {
      if (name !== wanted) continue;
      for (const ref of (doubleQuoted ?? singleQuoted ?? '').split(/\s+/).filter(Boolean)) {
        const area = rangeArea(ref);
        cells.largest = Math.max(cells.largest, area);
        cells.total += area;
      }
    }
  }
  return cells;
}
