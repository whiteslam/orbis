import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

vi.mock('server-only', () => ({}));

const { parseWorkbook } = await import('./parse');

/** A small real workbook: a header, two rows, a merge, column widths and a defined name. */
async function workbookBytes() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('My Sheet');
  sheet.columns = [{ header: 'Name', width: 20 }, { header: 'Amount', width: 12 }];
  sheet.addRow(['a', 1]);
  sheet.addRow(['b', 2]);
  sheet.mergeCells('D1:E2');
  workbook.definedNames.add("'My Sheet'!$A$1:$B$3", 'Data');
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

function xlsx(bytes: Uint8Array) {
  return new File([Buffer.from(bytes)], 'workbook.xlsx');
}

function editEntry(bytes: Uint8Array, name: string, change: (xml: string) => string, extra?: Record<number, Uint8Array>) {
  const entries: Zippable = unzipSync(bytes);
  const xml = change(strFromU8(entries[name] as Uint8Array));
  entries[name] = extra ? [strToU8(xml), { extra }] : strToU8(xml);
  return zipSync(entries);
}

const editSheet = (bytes: Uint8Array, change: (xml: string) => string) => editEntry(bytes, 'xl/worksheets/sheet1.xml', change);

test('a small workbook with a merge, column widths and a defined name still opens', async () => {
  const bytes = await workbookBytes();
  assert.ok((await parseWorkbook(xlsx(bytes))).sheets.length);
  const fullWidth = editSheet(bytes, (xml) => xml.replace(/<cols>.*<\/cols>/, '<cols><col min="1" max="16384" width="9" customWidth="1"/></cols>'));
  assert.ok((await parseWorkbook(xlsx(fullWidth))).sheets.length);
});

test('column spans past the last Excel column are refused before ExcelJS loads them', async () => {
  const bytes = editSheet(await workbookBytes(), (xml) => xml.replace(/<cols>.*<\/cols>/, '<cols><col min="1" max="100000000" width="9"/></cols>'));
  await assert.rejects(parseWorkbook(xlsx(bytes)), /column settings/);
});

test('a whole-sheet defined name is refused before ExcelJS loads it', async () => {
  const bytes = editEntry(await workbookBytes(), 'xl/workbook.xml', (xml) => xml.replace('$A$1:$B$3', '$A$1:$XFD$1048576'));
  await assert.rejects(parseWorkbook(xlsx(bytes)), /named ranges/);
});

test('an entry carrying an Info-ZIP Unicode path field is refused', async () => {
  const unicodePath = Uint8Array.from([1, 0, 0, 0, 0, ...strToU8('docProps/x.xml')]);
  const bytes = editEntry(await workbookBytes(), 'xl/worksheets/sheet1.xml', (xml) => xml, { 0x7075: unicodePath });
  await assert.rejects(parseWorkbook(xlsx(bytes)), /could not safely open/);
});
