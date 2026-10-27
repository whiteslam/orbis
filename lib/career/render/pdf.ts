/**
 * The tailored resume as an ATS-safe PDF: A4, Helvetica, one column, no
 * tables or images, real (selectable) text and the standard headings, so an
 * applicant-tracking system reads it back exactly as written.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { ResumeDoc, ResumeEntry, ResumeSection } from './layout.ts';
import { toWinAnsi } from './winansi.ts';

export { toWinAnsi } from './winansi.ts';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BULLET_INDENT = 12;
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.3, 0.3, 0.3);

const SIZE = { name: 18, headline: 11, contact: 9.5, heading: 11.5, title: 10.5, body: 10 } as const;
const LEADING = 1.3;

type Fonts = { regular: PDFFont; bold: PDFFont };
type Style = { font: PDFFont; size: number; color?: ReturnType<typeof rgb> };

/** Breaks text into lines no wider than `width`; a single over-long word gets a line of its own. */
export function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (!word) continue;
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** A cursor down the pages: starts a new page whenever the next block would not fit. */
class Writer {
  private page: PDFPage;
  private y = PAGE_HEIGHT - MARGIN;

  constructor(private readonly pdf: PDFDocument, readonly fonts: Fonts) {
    this.page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  }

  /** Makes room for `height` points, moving to a fresh page if needed. */
  ensure(height: number) {
    if (this.y - height >= MARGIN) return;
    this.page = this.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  gap(points: number) {
    this.y -= points;
  }

  /** One line of text at `x`, advancing the cursor by its leading. */
  line(text: string, style: Style, x = MARGIN) {
    const height = style.size * LEADING;
    this.ensure(height);
    this.y -= style.size;
    this.page.drawText(text, { x, y: this.y, size: style.size, font: style.font, color: style.color ?? INK });
    this.y -= height - style.size;
  }

  /** A wrapped paragraph; continuation lines hang at `indent`. */
  paragraph(text: string, style: Style, first = MARGIN, indent = first) {
    const width = CONTENT_WIDTH - (indent - MARGIN);
    let x = first;
    for (const part of wrapText(toWinAnsi(text), style.font, style.size, width)) {
      this.line(part, style, x);
      x = indent;
    }
  }

  /** Bold title on the left, dates flush right on the same line. */
  titleLine(title: string, dates: string | null) {
    const { bold, regular } = this.fonts;
    const dateText = dates ? toWinAnsi(dates) : '';
    const dateWidth = dateText ? regular.widthOfTextAtSize(dateText, SIZE.body) + 12 : 0;
    const titleLines = wrapText(toWinAnsi(title), bold, SIZE.title, CONTENT_WIDTH - dateWidth);
    const height = SIZE.title * LEADING;
    this.ensure(height * Math.max(1, titleLines.length));
    if (dateText) {
      this.page.drawText(dateText, {
        x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(dateText, SIZE.body),
        y: this.y - SIZE.title,
        size: SIZE.body,
        font: regular,
        color: MUTED,
      });
    }
    for (const part of titleLines) this.line(part, { font: bold, size: SIZE.title });
  }

  /** A section heading with a thin rule under it, kept on the page with what follows. */
  heading(text: string) {
    this.gap(8);
    this.ensure(SIZE.heading * LEADING + SIZE.body * LEADING * 2 + 4);
    this.line(toWinAnsi(text), { font: this.fonts.bold, size: SIZE.heading });
    const ruleY = this.y + 2;
    this.page.drawLine({ start: { x: MARGIN, y: ruleY }, end: { x: PAGE_WIDTH - MARGIN, y: ruleY }, thickness: 0.6, color: MUTED });
    this.gap(4);
  }
}

function drawEntry(writer: Writer, entry: ResumeEntry) {
  const { regular } = writer.fonts;
  writer.gap(3);
  // Keep the title with its first lines rather than stranding it at a page foot.
  writer.ensure(SIZE.title * LEADING + SIZE.body * LEADING * 2);
  writer.titleLine(entry.title, entry.dates);
  if (entry.meta) writer.paragraph(entry.meta, { font: regular, size: SIZE.body, color: MUTED });
  for (const bullet of entry.bullets) {
    writer.paragraph(`•  ${bullet}`, { font: regular, size: SIZE.body }, MARGIN, MARGIN + BULLET_INDENT);
  }
}

function drawSection(writer: Writer, section: ResumeSection) {
  writer.heading(section.heading);
  for (const text of section.paragraphs) writer.paragraph(text, { font: writer.fonts.regular, size: SIZE.body });
  for (const entry of section.entries) drawEntry(writer, entry);
}

/** The resume as PDF bytes. */
export async function renderResumePdf(doc: ResumeDoc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  const name = toWinAnsi(doc.name);
  pdf.setTitle(name ? `${name} - Resume` : 'Resume');
  if (name) pdf.setAuthor(name);
  pdf.setCreator('Orbis');
  pdf.setProducer('Orbis');

  const writer = new Writer(pdf, fonts);
  if (name) writer.paragraph(name, { font: fonts.bold, size: SIZE.name });
  if (doc.headline) writer.paragraph(doc.headline, { font: fonts.regular, size: SIZE.headline });
  if (doc.contact) writer.paragraph(doc.contact, { font: fonts.regular, size: SIZE.contact, color: MUTED });
  for (const section of doc.sections) drawSection(writer, section);
  return pdf.save();
}
