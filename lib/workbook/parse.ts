import 'server-only';

import ExcelJS from 'exceljs';
import yauzl from 'yauzl';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import type { ParsedWorkbookPreview, WorkbookObservation } from '@/lib/workbook/types';

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_SHEETS = 8;
const MAX_ROWS = 2_000;
const MAX_COLUMNS = 40;
const MAX_CELLS = 20_000;
const MAX_PREVIEW_BYTES = 24 * 1024;
const MAX_ARCHIVE_EXPANDED_BYTES = 12_000_000;
const MAX_ARCHIVE_ENTRIES = 1_024;
const MAX_PDF_PAGES = 50;
const MAX_PDF_TEXT_ITEMS = 20_000;
const MAX_PDF_TEXT_CHARS = 120_000;

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

type PdfTextSegment = { x: number; text: string };

// On the server pdfjs runs its worker in-process. Left alone it imports pdf.worker.mjs from beside its own file,
// which does not exist once Next bundles pdfjs into a server chunk. Registering the statically imported worker
// makes pdfjs use it directly.
(globalThis as typeof globalThis & { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

async function parsePdf(file: File, bytes: Buffer): Promise<ParsedWorkbookPreview> {
  if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('This file does not look like a valid PDF. Choose an Excel workbook or text-based PDF.');
  }

  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });

  try {
    const document = await loadingTask.promise;
    if (document.numPages > MAX_PDF_PAGES) {
      throw new Error(`This PDF has more than ${MAX_PDF_PAGES} pages. Split it into smaller files and try again.`);
    }

    const lines: Array<{ pageNumber: number; lineNumber: number; text: string }> = [];
    let textItemCount = 0;
    let textCharacterCount = 0;

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const grouped = new Map<number, PdfTextSegment[]>();

      for (const item of content.items) {
        if (!('str' in item) || typeof item.str !== 'string' || !item.str.trim()) continue;
        textItemCount += 1;
        textCharacterCount += item.str.length;
        if (textItemCount > MAX_PDF_TEXT_ITEMS || textCharacterCount > MAX_PDF_TEXT_CHARS) {
          throw new Error('This PDF contains too much text to preview safely. Choose a shorter or simpler document.');
        }

        const y = Math.round(item.transform[5] * 2) / 2;
        const segments = grouped.get(y) ?? [];
        segments.push({ x: item.transform[4], text: item.str.trim() });
        grouped.set(y, segments);
      }

      const pageLines = [...grouped.entries()]
        .sort(([leftY], [rightY]) => rightY - leftY)
        .map(([, segments]) => segments
          .sort((left, right) => left.x - right.x)
          .map((segment) => segment.text)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim())
        .filter(Boolean);

      for (const text of pageLines) {
        if (lines.length >= MAX_ROWS) {
          throw new Error(`This PDF has more than ${MAX_ROWS} text lines. Choose a shorter document and try again.`);
        }
        lines.push({ pageNumber, lineNumber: lines.length + 1, text });
      }
      page.cleanup();
    }

    if (!lines.length) {
      throw new Error('Orbis could not find selectable text in this PDF. Scanned image-only PDFs are not supported yet; choose a text-based PDF or Excel workbook.');
    }

    const meaningfulLines = lines.filter((line) => line.text.length >= 8);
    const numericLines = meaningfulLines.filter((line) => /\d/.test(line.text));
    const sourceLines = numericLines.length ? numericLines : meaningfulLines;
    const observationLines = sourceLines.length <= 24
      ? sourceLines
      : Array.from({ length: 24 }, (_, index) => sourceLines[Math.floor(index * (sourceLines.length - 1) / 23)]);
    const observations: WorkbookObservation[] = observationLines.map((line, index) => ({
      id: `obs_${index + 1}`,
      sheet: 'PDF text',
      column: 'Extracted text',
      label: `Extracted content from page ${line.pageNumber}`,
      value: `Page ${line.pageNumber}: ${line.text}`.slice(0, 240),
    }));

    const sheet: ParsedWorkbookPreview['sheets'][number] = {
      name: 'PDF text',
      rowCount: lines.length,
      columnCount: 2,
      columns: ['Page', 'Extracted text'],
      previewRows: lines.slice(0, 2).map((line) => ({
        rowNumber: line.lineNumber,
        values: [String(line.pageNumber), line.text.slice(0, 80)],
      })),
    };
    const preview: ParsedWorkbookPreview = { fileName: safeFileName(file.name), sheets: [sheet], observations };
    if (Buffer.byteLength(JSON.stringify(preview), 'utf8') > MAX_PREVIEW_BYTES) {
      throw new Error('This PDF is too complex to preview safely. Choose a shorter or simpler document.');
    }
    return preview;
  } catch (error) {
    if (error instanceof Error && /^(This PDF|Orbis could not find selectable text)/.test(error.message)) throw error;
    throw new Error('Orbis could not read this file. Check that it is a valid, unprotected PDF.');
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
}

export async function parseWorkbook(file: File): Promise<ParsedWorkbookPreview> {
  if (!(file instanceof File)) throw new Error('Choose an Excel workbook or PDF file.');
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension !== 'xlsx' && extension !== 'pdf') {
    throw new Error('Use an .xlsx workbook or .pdf file. CSV and older .xls files are not supported.');
  }
  if (!file.size) throw new Error('This file is empty. Choose a workbook or PDF with data.');
  if (file.size > MAX_FILE_BYTES) throw new Error('This file is larger than 100 MB. Choose a smaller file and try again.');

  const bytes = Buffer.from(await file.arrayBuffer());
  if (extension === 'pdf') return parsePdf(file, bytes);

  const workbook = new ExcelJS.Workbook();
  try {
    await checkXlsxArchiveSize(bytes);
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch (error) {
    throw new Error('Orbis could not read this file. Check that it is a valid, unprotected .xlsx workbook.');
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
