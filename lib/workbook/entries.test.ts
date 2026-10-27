import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ambiguousEntryName, entryNameKey } from './entries';

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
