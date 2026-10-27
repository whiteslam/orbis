import { test } from 'vitest';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { formatRange, resumeSections } from './layout.ts';
import { renderResumePdf, toWinAnsi } from './pdf.ts';
import { renderResumeDocx } from './docx.ts';
import { extractPdfText } from './pdf-text.ts';
import { atsCheck } from '../ats.ts';
import { sampleDraft, sampleProfile, sampleRequirements } from './fixtures.ts';

// ─── Layout ──────────────────────────────────────────────────────────────

test('dates read "Mon YYYY – Present"', () => {
  assert.equal(formatRange('2022-03', null), 'Mar 2022 – Present');
  assert.equal(formatRange('2019-07', '2022-02'), 'Jul 2019 – Feb 2022');
  assert.equal(formatRange('2019', '2021'), '2019 – 2021');
});

test('structure comes from the profile, words from the draft', () => {
  const doc = resumeSections(sampleProfile(), sampleDraft());
  assert.equal(doc.name, 'Priya Raman');
  assert.equal(doc.contact, 'priya.raman@example.com | +91 98765 43210 | Bengaluru, India | linkedin.com/in/priyaraman');
  assert.equal(doc.headline, 'Senior Frontend Engineer, React and TypeScript');
  assert.deepEqual(doc.sections.map((section) => section.heading), ['Summary', 'Skills', 'Experience', 'Projects', 'Education', 'Certifications']);
  assert.deepEqual(doc.sections[1].paragraphs, ['React, TypeScript, GraphQL, Next.js']);

  const experience = doc.sections[2].entries;
  assert.deepEqual(experience.map((entry) => entry.title), ['Senior Frontend Engineer', 'Frontend Engineer', 'Software Engineer Intern']);
  assert.equal(experience[0].meta, 'Acme Payments, Bengaluru');
  assert.equal(experience[0].dates, 'Mar 2022 – Present');
  assert.equal(experience[0].bullets.length, 3);
});

test('a role the draft leaves out still appears, with no bullets', () => {
  const doc = resumeSections(sampleProfile(), sampleDraft());
  const intern = doc.sections[2].entries.find((entry) => entry.title === 'Software Engineer Intern');
  assert.ok(intern);
  assert.equal(intern.dates, 'Jan 2018 – Jun 2018');
  assert.deepEqual(intern.bullets, []);
});

test('an emptied summary and headline fall back to the profile; unknown skills are not shown', () => {
  const draft = { ...sampleDraft(), headline: '', summary: { text: '', factIds: [] }, skills: ['react', 'kubernetes'] };
  const doc = resumeSections(sampleProfile(), draft);
  assert.equal(doc.headline, 'Senior frontend engineer');
  assert.deepEqual(doc.sections[0].paragraphs, ['Frontend engineer with seven years building fast, accessible React apps.']);
  assert.deepEqual(doc.sections[1].paragraphs, ['React']);
});

// ─── WinAnsi ─────────────────────────────────────────────────────────────

test('₹ becomes INR, WinAnsi punctuation is kept, the rest is transliterated or dropped', () => {
  assert.equal(toWinAnsi('Saved ₹1,20,000 a year'), 'Saved INR 1,20,000 a year');
  assert.equal(toWinAnsi('₹ 30 LPA'), 'INR 30 LPA');
  assert.equal(toWinAnsi('“Fast” – really — ‘yes’ • 5 €'), '“Fast” – really — ‘yes’ • 5 €');
  assert.equal(toWinAnsi('Café São Paulo Łódź'), 'Café São Paulo Lódz');
  assert.equal(toWinAnsi('ﬁxed p95 → 250 ms ≥ goal 🚀'), 'fixed p95 -> 250 ms >= goal');
  assert.equal(toWinAnsi('数据 team'), 'team');
});

test('whatever toWinAnsi returns, Helvetica can draw', async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let every = '';
  for (let code = 0x20; code < 0x3000; code += 1) every += String.fromCodePoint(code);
  const safe = toWinAnsi(`${every} ₹ 🚀`);
  assert.doesNotThrow(() => font.encodeText(safe));
  assert.ok(safe.length > 200);
});

// ─── PDF and the round trip ──────────────────────────────────────────────

test('the PDF reads back with its headings in order and passes the ATS check', async () => {
  const profile = sampleProfile();
  const bytes = await renderResumePdf(resumeSections(profile, sampleDraft()));
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 5)), '%PDF-');

  const { text, pages } = await extractPdfText(bytes);
  assert.equal(pages, 1);
  const lines = text.split('\n');
  const headings = lines.filter((line) => ['Summary', 'Skills', 'Experience', 'Projects', 'Education', 'Certifications'].includes(line));
  assert.deepEqual(headings, ['Summary', 'Skills', 'Experience', 'Projects', 'Education', 'Certifications']);
  assert.ok(text.includes('priya.raman@example.com'));
  assert.ok(text.includes('INR 1.2 Cr'), 'the rupee sign is spelled out');
  assert.ok(text.includes('Mar 2022 – Present'));

  const report = atsCheck({ text, pages, profile, requirements: sampleRequirements() });
  assert.equal(report.passed, true, JSON.stringify(report.checks));
  assert.deepEqual(report.missingKeywords, ['Kubernetes']);
  assert.equal(report.keywordCoverage, 0.8);
});

test('a long resume wraps and breaks onto more pages, and the check flags it', async () => {
  const profile = sampleProfile();
  const long = 'Rebuilt the merchant dashboard in React and TypeScript with a design system, tests and a careful rollout plan across teams';
  const draft = { ...sampleDraft(), roles: profile.roles.map((role) => ({ roleId: role.id, bullets: Array.from({ length: 30 }, () => ({ text: long, factIds: [] })) })) };
  const bytes = await renderResumePdf(resumeSections(profile, draft));
  const { text, pages } = await extractPdfText(bytes);
  assert.ok(pages >= 3, `expected 3+ pages, got ${pages}`);
  assert.ok(!text.split('\n').some((line) => line.length > 130), 'lines are wrapped to the page');
  const report = atsCheck({ text, pages, profile, requirements: null });
  assert.equal(report.passed, false);
  assert.equal(report.checks.find((check) => check.id === 'pages')?.ok, false);
});

// ─── DOCX ────────────────────────────────────────────────────────────────

test('the DOCX is a real Word file with the bullets in it and no tables', async () => {
  const bytes = await renderResumeDocx(resumeSections(sampleProfile(), sampleDraft()));
  assert.equal(String.fromCodePoint(bytes[0], bytes[1]), 'PK');
  const files = unzipSync(bytes);
  const xml = strFromU8(files['word/document.xml']);
  assert.ok(xml.includes('Led 4 engineers rebuilding the merchant dashboard in React and TypeScript'));
  assert.ok(xml.includes('Heading1'));
  assert.ok(xml.includes('<w:numPr>'), 'bullets are real Word list items');
  assert.ok(files['word/numbering.xml']);
  assert.ok(xml.includes('Mar 2022 – Present'));
  assert.ok(!xml.includes('<w:tbl>'));
  assert.ok(!xml.includes('<w:drawing>'));
});
