import { test } from 'vitest';
import assert from 'node:assert/strict';
import { expandedRangeCells, rangeArea } from './ranges';

const WHOLE_SHEET = 1_048_576 * 16_384;

test('a single cell and a rectangle count their cells', () => {
  assert.equal(rangeArea('A1'), 1);
  assert.equal(rangeArea('A1:B2'), 4);
  assert.equal(rangeArea('B2:A1'), 4);
  assert.equal(rangeArea('A1:Z10000'), 260_000);
  assert.equal(rangeArea('AA10:AB11'), 4);
});

test('absolute references count the same as relative ones', () => {
  assert.equal(rangeArea('$A$1:$B$2'), 4);
  assert.equal(rangeArea('$C$3'), 1);
  assert.equal(rangeArea('A$1:$B2'), 4);
});

test('whole columns and whole rows count as the full sheet height or width', () => {
  assert.equal(rangeArea('A:A'), 1_048_576);
  assert.equal(rangeArea('$A:$C'), 3 * 1_048_576);
  assert.equal(rangeArea('1:1'), 16_384);
  assert.equal(rangeArea('A1:XFD1048576'), WHOLE_SHEET);
});

test('a reference it cannot read counts as the whole sheet', () => {
  for (const ref of ['', 'A1:', ':A1', 'A1:B2:C3', 'A:1', 'A1:B', '&#65;1:&#88;FD1048576', 'Sheet1!A1:B2', 'ABCD1']) {
    assert.equal(rangeArea(ref), WHOLE_SHEET, ref);
  }
});

test('merge and data validation ranges are measured from the sheet XML', () => {
  const xml = `<worksheet><sheetData/>
    <mergeCells count="2"><mergeCell ref="A1:B2"/><mergeCell ref='C1:C3'/></mergeCells>
    <dataValidations count="1"><dataValidation type="whole" allowBlank="1" sqref="D1:D10 F1 $G$1:$G$2"><formula1>1</formula1></dataValidation></dataValidations>
  </worksheet>`;
  assert.deepEqual(expandedRangeCells(xml), { largest: 10, total: 4 + 3 + 10 + 1 + 2 });
});

test('a huge merge or validation range is found however its tag is written', () => {
  assert.equal(expandedRangeCells('<mergeCell ref="A1:XFD1048576"/>').largest, WHOLE_SHEET);
  assert.equal(expandedRangeCells('<x:mergeCell\n  ref = "A1:XFD1048576" />').largest, WHOLE_SHEET);
  assert.equal(expandedRangeCells('<mergeCell note=">" ref="A1:XFD1048576"/>').largest, WHOLE_SHEET);
  assert.equal(expandedRangeCells('<dataValidation type="list" sqref="A:A"></dataValidation>').largest, 1_048_576);
});

test('selections, conditional formatting and other attributes are not counted', () => {
  const xml = `<sheetViews><sheetView><selection activeCell="A1" sqref="A1:A1048576"/></sheetView></sheetViews>
    <dataValidations count="1" sqref="A:A"/>
    <conditionalFormatting sqref="A:A"><cfRule type="expression"/></conditionalFormatting>
    <mergeCell sqref="A:A" ref="B1:B2"/>
    <dataValidation ref="A:A" sqref="C1"/>`;
  assert.deepEqual(expandedRangeCells(xml), { largest: 2, total: 3 });
});
