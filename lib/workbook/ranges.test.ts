import { test } from 'vitest';
import assert from 'node:assert/strict';
import { declaredColumnExtent, definedNameRangeCells, expandedRangeCells, rangeArea } from './ranges';

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

test('unterminated merge and validation tags are scanned in linear time', () => {
  for (const xml of ['<mergeCell '.repeat(200_000), '<dataValidation sqref="A1" '.repeat(100_000), '<x:mergeCell ref="'.repeat(100_000)]) {
    const started = performance.now();
    assert.deepEqual(expandedRangeCells(xml), { largest: 0, total: 0 });
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 1_000, `took ${elapsed} ms`);
  }
});

test('a broken tag does not hide the well-formed tag after it', () => {
  assert.equal(expandedRangeCells('<mergeCell ref="A1:B2" <mergeCell ref="A1:XFD1048576"/>').largest, WHOLE_SHEET);
  assert.equal(expandedRangeCells('<mergeCells><mergeCell ref="C1:C3"/></mergeCells>').total, 3);
  assert.equal(expandedRangeCells('<mergeCellX ref="A:A"/><dataValidations sqref="A:A"/><a:b:mergeCell ref="A:A"/>').total, 0);
});

test('column spans report the highest column they reach', () => {
  assert.equal(declaredColumnExtent('<sheetData/>'), 0);
  assert.equal(declaredColumnExtent('<cols><col min="1" max="3" width="9"/><col min="5" max="5"/></cols>'), 5);
  // A styled A:XFD span is common in real files and stays within Excel's own limit.
  assert.equal(declaredColumnExtent('<x:cols><x:col min="1" max="16384" style="2"/></x:cols>'), 16_384);
  assert.equal(declaredColumnExtent('<cols><col min="1" max="100000000" width="9"/></cols>'), Infinity);
  assert.equal(declaredColumnExtent('<cols><col min="99999" max="99999"/></cols>'), 99_999);
});

test('column spans that are not whole numbers with 1 <= min <= max are unbounded', () => {
  for (const col of ['<col min="0" max="3"/>', '<col min="4" max="3"/>', '<col min="1" max="2.5"/>', '<col min="1"/>', '<col min="-1" max="3"/>', '<col min="1" max="1e9"/>', '<col min="1" max="&#49;"/>']) {
    assert.equal(declaredColumnExtent(`<cols>${col}</cols>`), Infinity, col);
  }
});

test('defined names count the ranges ExcelJS would expand', () => {
  const xml = `<workbook><definedNames>
    <definedName name="Rates">Sheet1!$A$1:$B$10</definedName>
    <definedName name="Two" localSheetId="0">'My &amp; Sheet'!$C$1:$C$5,Sheet1!$D$1</definedName>
    <definedName name="_xlnm.Print_Titles" localSheetId="0">Sheet1!$1:$1,Sheet1!$A:$A</definedName>
    <definedName name="Formula">OFFSET(Sheet1!$A$1,0,0,COUNTA(Sheet1!$A:$A),1)</definedName>
    <definedName name="Sum">SUM(Sheet1!$A$1:$A$4)</definedName>
    <definedName name="Constant">0.05</definedName>
    <definedName name="Broken">#REF!</definedName>
    <definedName name="Empty"/>
  </definedNames></workbook>`;
  assert.deepEqual(definedNameRangeCells(xml), { largest: 20, total: 20 + 5 + 1 + 1 + 4 });
});

test('a whole-sheet defined name is found however it is written', () => {
  for (const value of [
    'Sheet1!$A$1:$XFD$1048576',
    "'Sheet, one'!$A$1:$XFD$1048576",
    '&#83;heet1!&#36;A&#36;1:&#36;XFD&#36;1048576',
    'Sheet1!$A$1 Sheet1!$A$1:$XFD$1048576',
    'A1:XFD1048576 $B$2',
    'S!$A$1:$Z$9999!$B$2',
    'Sheet1!$A$1:$B$2:$XFD$1048576',
    "'unterminated!$A$1",
    'Sheet1!$A$1:$B$99999999',
  ]) {
    assert.ok(definedNameRangeCells(`<definedName name="n">${value}</definedName>`).largest >= 1_000_000, value);
  }
});

test('a defined name whose text cannot be read counts as the whole sheet', () => {
  for (const xml of [
    '<definedName name="n"><![CDATA[Sheet1!$A$1:$XFD$1048576]]></definedName>',
    '<definedName name="n">Sheet1!$A$1&bogus;</definedName>',
    '<definedName name="n">Sheet1!$A$1',
    '<definedName name="n">Sheet1!$A$1<!-- x --></definedName>',
  ]) {
    assert.equal(definedNameRangeCells(xml).largest, WHOLE_SHEET, xml);
  }
});

test('defined names are scanned in linear time', () => {
  for (const xml of ['<definedName '.repeat(200_000), `<definedName name="n">${"'".repeat(1_000_000)}</definedName>`, `<definedName>${'$a'.repeat(500_000)}</definedName>`]) {
    const started = performance.now();
    definedNameRangeCells(xml);
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 1_000, `took ${elapsed} ms`);
  }
});
