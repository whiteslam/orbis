/**
 * Reads a PDF's text back the way an applicant-tracking system would: the
 * selectable text only, line by line, top to bottom. Used by the ATS check on
 * our own rendered resume, and on an uploaded master resume.
 *
 * No 'server-only' marker so the round-trip test can run under vitest; it is
 * only ever imported from server code.
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';

// On the server pdfjs runs its worker in-process. Left alone it imports pdf.worker.mjs from beside its own file,
// which does not exist once Next bundles pdfjs into a server chunk. Registering the statically imported worker
// makes pdfjs use it directly (the same as lib/workbook/parse.ts).
(globalThis as typeof globalThis & { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

// A resume is a few pages; anything far beyond that is not one, and is not read in full.
const MAX_PAGES = 20;
const MAX_CHARS = 200_000;

type PdfDocument = Awaited<ReturnType<typeof getDocument>['promise']>;
type PdfTextItems = Awaited<ReturnType<Awaited<ReturnType<PdfDocument['getPage']>>['getTextContent']>>['items'];
type Segment = { x: number; text: string };

/** One page's text items joined into lines, top to bottom, left to right. */
function pageLines(items: PdfTextItems): string[] {
  const rows = new Map<number, Segment[]>();
  for (const item of items) {
    if (!('str' in item) || !item.str.trim()) continue;
    // Items on one baseline are one line; half-point rounding absorbs float noise.
    const y = Math.round(item.transform[5] * 2) / 2;
    const row = rows.get(y) ?? [];
    row.push({ x: item.transform[4], text: item.str });
    rows.set(y, row);
  }
  return [...rows.entries()]
    .sort(([top], [bottom]) => bottom - top)
    .map(([, row]) => row.toSorted((left, right) => left.x - right.x).map((segment) => segment.text).join(' ').replaceAll(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** The PDF's text, one line per visual line and a blank line between pages, and its page count. */
export async function extractPdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  // pdfjs takes ownership of the buffer it is given; a copy leaves the caller's bytes usable.
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  try {
    const document = await task.promise;
    const pageTexts: string[] = [];
    let chars = 0;
    for (let number = 1; number <= Math.min(document.numPages, MAX_PAGES) && chars < MAX_CHARS; number += 1) {
      const page = await document.getPage(number); // NOSONAR: one page at a time, so each is released before the next
      const content = await page.getTextContent(); // NOSONAR: as above
      const text = pageLines(content.items).join('\n');
      page.cleanup();
      chars += text.length;
      pageTexts.push(text);
    }
    return { text: pageTexts.join('\n\n').slice(0, MAX_CHARS), pages: document.numPages };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
