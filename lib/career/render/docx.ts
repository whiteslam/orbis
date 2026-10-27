/**
 * The tailored resume as a Word document, for forms that want .docx. Same
 * shape as the PDF: one column, Word's built-in heading styles, real bullets,
 * no tables, images or text boxes, so ATS parsers read it cleanly.
 */
import { Document, HeadingLevel, Packer, Paragraph, TabStopType, TextRun } from 'docx';
import type { ResumeDoc, ResumeEntry, ResumeSection } from './layout.ts';

// A4 in twips, with 0.7" margins: the same page the PDF uses.
const A4 = { width: 11906, height: 16838 };
const MARGIN = 1008;
const FONT = 'Calibri';
const MUTED = '4D4D4D';

function entryParagraphs(entry: ResumeEntry): Paragraph[] {
  const title = new Paragraph({
    spacing: { before: 120 },
    keepNext: true,
    // A right tab stop puts the dates flush right without a table.
    tabStops: [{ type: TabStopType.RIGHT, position: A4.width - MARGIN * 2 }],
    children: [
      new TextRun({ text: entry.title, bold: true }),
      ...(entry.dates ? [new TextRun({ text: `\t${entry.dates}`, color: MUTED })] : []),
    ],
  });
  const paragraphs = [title];
  if (entry.meta) paragraphs.push(new Paragraph({ keepNext: entry.bullets.length > 0, children: [new TextRun({ text: entry.meta, color: MUTED })] }));
  for (const bullet of entry.bullets) paragraphs.push(new Paragraph({ text: bullet, bullet: { level: 0 } }));
  return paragraphs;
}

function sectionParagraphs(section: ResumeSection): Paragraph[] {
  return [
    new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_1, keepNext: true }),
    ...section.paragraphs.map((text) => new Paragraph({ text })),
    ...section.entries.flatMap(entryParagraphs),
  ];
}

function header(doc: ResumeDoc): Paragraph[] {
  const lines: Paragraph[] = [];
  if (doc.name) lines.push(new Paragraph({ text: doc.name, heading: HeadingLevel.TITLE }));
  if (doc.headline) lines.push(new Paragraph({ children: [new TextRun({ text: doc.headline, size: 24 })] }));
  if (doc.contact) lines.push(new Paragraph({ children: [new TextRun({ text: doc.contact, color: MUTED })] }));
  return lines;
}

/** The resume as .docx bytes. */
export async function renderResumeDocx(doc: ResumeDoc): Promise<Uint8Array> {
  const file = new Document({
    title: doc.name ? `${doc.name} - Resume` : 'Resume',
    creator: 'Orbis',
    styles: {
      default: {
        document: { run: { font: FONT, size: 21 }, paragraph: { spacing: { after: 40 } } },
        title: { run: { font: FONT, size: 36, bold: true, color: '1A1A1A' }, paragraph: { spacing: { after: 40 } } },
        heading1: { run: { font: FONT, size: 24, bold: true, color: '1A1A1A' }, paragraph: { spacing: { before: 240, after: 80 } } },
      },
    },
    sections: [{
      properties: { page: { size: A4, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } },
      children: [...header(doc), ...doc.sections.flatMap(sectionParagraphs)],
    }],
  });
  return new Uint8Array(await Packer.toBuffer(file));
}
