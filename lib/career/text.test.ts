import { test } from 'vitest';
import assert from 'node:assert/strict';
import { clipText, collapseWhitespace, decodeEntities, htmlToText, repairMojibake } from './text.ts';

test('decodes named, decimal and hex entities once', () => {
  assert.equal(decodeEntities('R&amp;D &#8217;s &#x2F;jobs&#x2F; &nbsp;x &mdash;'), 'R&D ’s /jobs/  x —');
  assert.equal(decodeEntities('&amp;lt;p&amp;gt;'), '&lt;p&gt;');
});

test('leaves unknown or broken entities as written', () => {
  assert.equal(decodeEntities('AT&T & co &bogus; &#xZZ; &#0;'), 'AT&T & co &bogus; &#xZZ; &#0;');
});

test('block tags become lines, list items bullets, inline tags vanish', () => {
  const html = '<h2>About</h2><p>We build <strong>fast</strong> tools.</p><ul><li>React</li><li>Node &amp; Go</li></ul><p>Apply<br>today</p>';
  assert.equal(htmlToText(html), 'About\nWe build fast tools.\n• React\n• Node & Go\nApply\ntoday');
});

test('drops scripts, styles and comments, keeps a lone "<"', () => {
  assert.equal(htmlToText('<style>p{color:red}</style><!-- hi --><p>a < b</p><script>alert(1)</script>'), 'a < b');
});

test('copes with a tag cut off at the end', () => {
  assert.equal(htmlToText('<p>Hello</p><a href="x'), 'Hello\n<a href="x');
});

test('drops empty lines and empty bullets', () => {
  assert.equal(htmlToText('<p>One</p><p></p><p>&nbsp;</p><ul><li></li></ul><div><div>Two</div></div>'), 'One\nTwo');
});

test('collapseWhitespace', () => {
  assert.equal(collapseWhitespace('  a \n\t b  '), 'a b');
});

test('clipText cuts at a word with an ellipsis, and leaves short text alone', () => {
  assert.equal(clipText('short', 10), 'short');
  assert.equal(clipText('the quick brown fox jumps', 20), 'the quick brown fox…');
  assert.equal(clipText('abcdefghijklmnopqrstuvwxyz', 10), 'abcdefghi…');
  assert.ok(clipText('x'.repeat(30_000), 20_000).length <= 20_000);
});

test('repairMojibake fixes UTF-8 read as Latin-1 and leaves good text alone', () => {
  assert.equal(repairMojibake('Weâ\u0080\u0099re hiring 1â\u0080\u00932'), 'We’re hiring 1–2');
  assert.equal(repairMojibake('Café – naïve ’'), 'Café – naïve ’');
});
