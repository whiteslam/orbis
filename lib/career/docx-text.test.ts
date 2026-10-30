import { test } from 'vitest';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { docxText, documentXmlText, resumeKind } from './docx-text.ts';
import { renderResumeDocx } from './render/docx.ts';
import { resumeSections } from './render/layout.ts';
import { sampleDraft, sampleProfile } from './render/fixtures.ts';

const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>Priya Raman</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">React </w:t></w:r><w:r><w:t>&amp; TypeScript</w:t></w:r></w:p>
<w:p><w:r><w:t>2019</w:t><w:tab/><w:t>Bolt Labs</w:t><w:br/><w:t>Pune</w:t></w:r></w:p>
<w:p/><w:p/><w:p/>
<w:p><w:r><w:t/></w:r><w:r><w:t>Cut p95 &lt;250 ms</w:t></w:r></w:p>
</w:body></w:document>`;

test('document.xml reads as one line per paragraph, with tabs, breaks and entities', () => {
  assert.equal(documentXmlText(XML), 'Priya Raman\nReact & TypeScript\n2019\tBolt Labs\nPune\n\nCut p95 <250 ms');
});

test('a DOCX zip gives its body text; anything else gives null', () => {
  const docx = zipSync({ 'word/document.xml': strToU8(XML), '[Content_Types].xml': strToU8('<Types/>') });
  assert.match(docxText(docx) ?? '', /^Priya Raman\nReact & TypeScript/);
  assert.equal(docxText(zipSync({ 'other.xml': strToU8('<x/>') })), null);
  assert.equal(docxText(new Uint8Array([1, 2, 3])), null);
});

test('our own rendered DOCX reads back', async () => {
  const bytes = await renderResumeDocx(resumeSections(sampleProfile(), sampleDraft()));
  const text = docxText(bytes) ?? '';
  assert.match(text, /Priya Raman/);
  assert.match(text, /Experience/);
  assert.equal(resumeKind(bytes), 'docx');
});

test('files are told apart by their signature', () => {
  assert.equal(resumeKind(strToU8('%PDF-1.7 …')), 'pdf');
  assert.equal(resumeKind(strToU8('hello')), null);
});

test('a zip naming word/document.xml twice is refused, not inflated twice', () => {
  const zip = zipSync({ 'word/document.xml': strToU8(XML), 'word/documenX.xml': strToU8(XML) });
  // Rename the second entry in both its local header and the central directory.
  const twin = strToU8('word/documenX.xml');
  for (let i = 0; i + twin.length <= zip.length; i += 1) {
    if (twin.every((byte, offset) => zip[i + offset] === byte)) zip[i + twin.length - 5] = 't'.charCodeAt(0);
  }
  assert.equal(docxText(zip), null);
});
