import 'server-only';

import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import yauzl from 'yauzl';
import type { ParsedWorkbookPreview, WorkbookObservation } from '@/lib/workbook/types';

const MAX_FILE_BYTES = 1_572_864;
const MAX_SHEETS = 8;
const MAX_ROWS = 2_000;
const MAX_COLUMNS = 40;
const MAX_CELLS = 20_000;
const MAX_PREVIEW_BYTES = 24 * 1024;
const MAX_ARCHIVE_EXPANDED_BYTES = 12_000_000;
const MAX_ARCHIVE_ENTRIES = 1_024;

async function checkXlsxArchiveSize(bytes: Buffer) {
  const archive = await yauzl.fromBufferPromise(bytes, { lazyEntries: true, validateEntrySizes: true });
  let declaredExpandedBytes = 0;
  let streamedExpandedBytes = 0;
  let entryCount = 0;

  try {
    for await (const entry of archive.eachEntry()) {
      if (entry.fileName.endsWith('/')) continue;
      entryCount += 1;
      declaredExpandedBytes += entry.uncompressedSize;
      if (entryCount > MAX_ARCHIVE_ENTRIES || declaredExpandedBytes > MAX_ARCHIVE_EXPANDED_BYTES) {
        archive.close();
        throw new Error('This workbook expands beyond the safe processing limit. Save a simpler workbook and try again.');
      }

      const stream = await archive.openReadStreamPromise(entry);
      for await (const chunk of stream) {
        streamedExpandedBytes += Buffer.byteLength(chunk);
        if (streamedExpandedBytes > MAX_ARCHIVE_EXPANDED_BYTES) {
          stream.destroy();
          archive.close();
          throw new Error('This workbook expands beyond the safe processing limit. Save a simpler workbook and try again.');
        }
      }
    }
  } catch (error) {
    archive.close();
    if (error instanceof Error && error.message.includes('safe processing limit')) throw error;
    throw new Error('Orbis could not safely open this workbook. Check that it is a valid .xlsx file.');
  }
}

function safeCellValue(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value.trim().slice(0, 80);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    return value.map((part) => typeof part === 'object' && part && 'text' in part ? String(part.text ?? '') : '').join('').trim().slice(0, 80);
  }

  if (typeof value === 'object') {
    if ('result' in value && value.result !== undefined) return safeCellValue(value.result as ExcelJS.CellValue);
    if ('text' in value && typeof value.text === 'string') return value.text.trim().slice(0, 80);
    if ('error' in value) return 'Spreadsheet error';
    if ('formula' in value || 'sharedFormula' in value) return 'Calculated value';
    return '';
  }

  return '';
}

function numericValue(value: string) {
  const normalized = value.replace(/,/g, '').replace(/^[$£€₹]\s*/, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function safeFileName(name: string) {
  const basename = name.split(/[\\/]/).pop() ?? 'workbook';
  return basename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'workbook';
}

export async function parseWorkbook(file: File): Promise<ParsedWorkbookPreview> {
  if (!(file instanceof File)) throw new Error('Choose an Excel workbook or CSV file.');
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension !== 'xlsx' && extension !== 'csv') {
    throw new Error('Use an .xlsx workbook or .csv file. Older .xls files are not supported yet.');
  }
  if (!file.size) throw new Error('This file is empty. Choose a workbook with data.');
  if (file.size > MAX_FILE_BYTES) throw new Error('This file is larger than 1.5 MB. Save a smaller workbook and try again.');

  const bytes = Buffer.from(await file.arrayBuffer());
  const workbook = new ExcelJS.Workbook();
  try {
    if (extension === 'xlsx') {
      await checkXlsxArchiveSize(bytes);
      await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    } else {
      const csvType = file.type;
      if (csvType && !['text/csv', 'application/vnd.ms-excel', 'application/octet-stream'].includes(csvType)) {
        throw new Error('The selected file does not look like a CSV.');
      }
      await workbook.csv.read(Readable.from([bytes]));
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'The selected file does not look like a CSV.') throw error;
    throw new Error('Orbis could not read this file. Check that it is a valid, unprotected .xlsx or .csv workbook.');
  }

  if (workbook.worksheets.length === 0) throw new Error('No worksheets with data were found in this file.');
  if (workbook.worksheets.length > MAX_SHEETS) throw new Error(`This workbook has more than ${MAX_SHEETS} worksheets. Remove extra sheets and try again.`);

  let totalRows = 0;
  let totalCells = 0;
  let observationNumber = 0;
  const observations: WorkbookObservation[] = [];
  const sheets: ParsedWorkbookPreview['sheets'] = [];

  for (const worksheet of workbook.worksheets) {
    let maxColumn = 0;
    const rows: Array<{ rowNumber: number; values: string[] }> = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      totalRows += 1;
      if (totalRows > MAX_ROWS + MAX_SHEETS) throw new Error(`This workbook has more than ${MAX_ROWS} non-empty rows. Remove extra rows and try again.`);
      maxColumn = Math.max(maxColumn, row.cellCount);
      if (maxColumn > MAX_COLUMNS) throw new Error(`A worksheet has more than ${MAX_COLUMNS} columns. Remove extra columns and try again.`);
      const values = Array.from({ length: maxColumn }, (_, index) => safeCellValue(row.getCell(index + 1).value));
      totalCells += values.filter(Boolean).length;
      if (totalCells > MAX_CELLS) throw new Error(`This workbook has more than ${MAX_CELLS} filled cells. Use a smaller workbook and try again.`);
      if (values.some(Boolean)) rows.push({ rowNumber: row.number, values });
    });

    if (!rows.length) continue;
    const headerRow = rows[0];
    const columnCount = Math.min(MAX_COLUMNS, Math.max(headerRow.values.length, ...rows.map((row) => row.values.length)));
    const columns = Array.from({ length: columnCount }, (_, index) => {
      const heading = headerRow.values[index]?.trim();
      return (heading || `Column ${index + 1}`).slice(0, 48);
    });
    const dataRows = rows.slice(1);
    const visibleColumnCount = Math.min(columns.length, 10);
    const previewRows = dataRows.slice(0, 2).map((row) => ({
      rowNumber: row.rowNumber,
      values: Array.from({ length: visibleColumnCount }, (_, index) => row.values[index] ?? ''),
    }));

    for (let columnIndex = 0; columnIndex < columnCount && observations.length < 24; columnIndex += 1) {
      const numeric = dataRows.map((row) => numericValue(row.values[columnIndex] ?? '')).filter((value): value is number => value !== null);
      if (numeric.length < 3) continue;
      const sum = numeric.reduce((total, value) => total + value, 0);
      const average = sum / numeric.length;
      observationNumber += 1;
      observations.push({
        id: `obs_${observationNumber}`,
        sheet: worksheet.name.slice(0, 48),
        column: columns[columnIndex],
        label: `Numeric pattern in ${columns[columnIndex]}`,
        value: `${numeric.length} values; sum ${Number(sum.toFixed(2))}; average ${Number(average.toFixed(2))}; range ${Math.min(...numeric)}–${Math.max(...numeric)}`.slice(0, 240),
      });
    }

    sheets.push({
      name: worksheet.name.slice(0, 48),
      rowCount: dataRows.length,
      columnCount,
      columns: columns.slice(0, 10),
      previewRows,
    });
  }

  if (!sheets.length) throw new Error('No usable rows were found. Add a header row and at least one data row, then try again.');

  const preview: ParsedWorkbookPreview = { fileName: safeFileName(file.name), sheets, observations };
  if (Buffer.byteLength(JSON.stringify(preview), 'utf8') > MAX_PREVIEW_BYTES) {
    throw new Error('This workbook is too complex to preview safely. Reduce its worksheets, columns, or cell text and try again.');
  }
  return preview;
}
