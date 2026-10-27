/**
 * Text made safe for pdf-lib's standard Helvetica, which can only encode
 * WinAnsi (Windows-1252). Anything else would throw while drawing. Pure.
 */

// The Windows-1252 characters outside Latin-1, which Helvetica can draw.
const CP1252_EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

// Common characters with a readable WinAnsi stand-in. ₹ is spelled out because
// Helvetica has no rupee sign and a bare number would lose the currency.
const REPLACEMENTS = new Map<string, string>([
  ['₹', 'INR '],
  ['\u00A0', ' '],
  ['\u2009', ' '],
  ['\u202F', ' '],
  ['\u2002', ' '],
  ['\u2003', ' '],
  ['\t', ' '],
  ['\u00AD', ''],
  ['\u200B', ''],
  ['\u200C', ''],
  ['\u200D', ''],
  ['\uFEFF', ''],
  ['\u2010', '-'],
  ['\u2011', '-'],
  ['\u2012', '-'],
  ['\u2212', '-'],
  ['\u2015', '—'],
  ['′', "'"],
  ['\u2033', '"'],
  ['\u2192', '->'],
  ['\u2190', '<-'],
  ['\u2264', '<='],
  ['\u2265', '>='],
  ['\u2248', '~'],
  ['\u2260', '!='],
  ['\u2713', ''],
  ['\u2714', ''],
  // Letters with no decomposition to a base letter.
  ['Ł', 'L'],
  ['ł', 'l'],
  ['Đ', 'D'],
  ['đ', 'd'],
  ['ı', 'i'],
  ['\u25CF', '•'],
  ['\u25AA', '•'],
  ['\u2023', '•'],
  ['\u2043', '•'],
]);

function encodable(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa1 && code <= 0xff) return code !== 0xad;
  return CP1252_EXTRAS.has(char);
}

/** One character as WinAnsi: itself, a stand-in, its accent-free letters, or nothing. */
function translate(char: string): string {
  if (encodable(char)) return char;
  const replacement = REPLACEMENTS.get(char);
  if (replacement !== undefined) return replacement;
  if (char === '\n' || char === '\r') return ' ';
  // "ā" → "a", "ﬁ" → "fi": decompose and keep only what Helvetica can draw.
  let plain = '';
  for (const part of char.normalize('NFKD')) {
    if (encodable(part)) plain += part;
  }
  return plain;
}

/** Text Helvetica can draw: WinAnsi only, ₹ as "INR ", runs of spaces collapsed. */
export function toWinAnsi(text: string): string {
  let out = '';
  for (const char of text) out += translate(char);
  return out.replaceAll(/ {2,}/g, ' ').trim();
}
