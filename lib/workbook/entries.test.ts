import { test } from 'vitest';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { ambiguousEntryName, entryNameKey, unusualEntryPath, zipLayoutIsExact } from './entries';

const ascii = (name: string) => new TextEncoder().encode(name);

test('ordinary ASCII entry names with ordinary extra fields are not ambiguous', () => {
  assert.equal(ambiguousEntryName(ascii('xl/worksheets/sheet1.xml'), []), false);
  // Zip64 and extended-timestamp fields do not change an entry's name.
  assert.equal(ambiguousEntryName(ascii('xl/workbook.xml'), [0x0001, 0x5455]), false);
});

test('Info-ZIP Unicode path and comment fields make an entry ambiguous', () => {
  assert.equal(ambiguousEntryName(ascii('xl/worksheets/sheet1.xml'), [0x7075]), true);
  assert.equal(ambiguousEntryName(ascii('docProps/app.xml'), [0x5455, 0x6375]), true);
});

test('non-ASCII name bytes make an entry ambiguous', () => {
  // An overlong two-byte encoding of "x", which JSZip decodes as "x" and yauzl does not.
  assert.equal(ambiguousEntryName(Uint8Array.from([0xc1, 0xb8, ...ascii('l/worksheets/sheet1.xml')]), []), true);
  assert.equal(ambiguousEntryName(ascii('xl/media/café.png'), []), true);
});

test('names that one zip reader could treat as the same file share a key', () => {
  assert.equal(entryNameKey('xl/worksheets/sheet1.xml'), entryNameKey('XL\\Worksheets\\Sheet1.xml'));
  assert.equal(entryNameKey('/xl/workbook.xml'), entryNameKey('xl/workbook.xml'));
  assert.notEqual(entryNameKey('xl/worksheets/sheet1.xml'), entryNameKey('xl/worksheets/sheet2.xml'));
});

test('paths JSZip would resolve differently are unusual', () => {
  assert.equal(unusualEntryPath('xl/worksheets/sheet1.xml'), false);
  assert.equal(unusualEntryPath('xl/worksheets/'), false);
  for (const name of ['xl/./workbook.xml', 'xl/worksheets/../workbook.xml', 'xl//workbook.xml', '/xl/workbook.xml']) assert.equal(unusualEntryPath(name), true, name);
});

test('a zip whose directory matches its end record exactly passes', () => {
  const zip = zipSync({ 'xl/workbook.xml': strToU8('<workbook/>'), 'xl/worksheets/sheet1.xml': strToU8('<worksheet/>') });
  assert.equal(zipLayoutIsExact(zip), true);
});

test('a zip with bytes before it, or more directory records than declared, is refused', () => {
  const zip = zipSync({ 'xl/workbook.xml': strToU8('<workbook/>'), 'xl/worksheets/sheet1.xml': strToU8('<worksheet/>') });
  const shifted = new Uint8Array(zip.length + 16);
  shifted.set(zip, 16);
  assert.equal(zipLayoutIsExact(shifted), false);
  const undercounted = zip.slice();
  const view = new DataView(undercounted.buffer);
  const eocd = undercounted.length - 22;
  view.setUint16(eocd + 8, 1, true);
  view.setUint16(eocd + 10, 1, true);
  assert.equal(zipLayoutIsExact(undercounted), false);
  assert.equal(zipLayoutIsExact(strToU8('not a zip at all, just text')), false);
});
