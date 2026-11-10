import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseCaps, validatePlan, wordCount } from './plan';

const GOOD = {
  title: '  What If You Swallow Gum? ',
  seconds: 30,
  lines: [
    { text: 'What happens if you swallow your gum?', caps: 'WHAT *HAPPENS | IF YOU *SWALLOW | YOUR *GUM?', shot: 'Hero holds gum' },
    { text: 'Well, it slides down your throat,', caps: 'WELL, IT *SLIDES | DOWN YOUR *THROAT', shot: 'X-ray zoom' },
    { text: 'So maybe, just spit it out.', caps: 'SO *MAYBE... | SPIT IT *OUT', shot: 'Wink to camera' },
  ],
  sources: ['Mayo Clinic'],
};

const errorsOf = (input: unknown) => {
  const result = validatePlan(input);
  return result.ok ? [] : result.errors;
};

test('caption chunks split on | and mark the one yellow word', () => {
  const chunks = parseCaps('WHAT *HAPPENS | IF YOU *SWALLOW');
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[0], { words: ['WHAT', '*HAPPENS'], keyword: 1 });
  assert.equal(chunks[1].keyword, 2);
  assert.equal(parseCaps('NO STAR')[0].keyword, -1);
  assert.deepEqual(parseCaps(''), []);
});

test('a good plan is accepted and trimmed', () => {
  const result = validatePlan(GOOD);
  assert.ok(result.ok);
  assert.equal(result.plan.title, 'What If You Swallow Gum?');
  assert.equal(result.plan.lines.length, 3);
  assert.equal(result.plan.notes, '');
  assert.equal(wordCount(result.plan), 19);
});

test('notes and sources are optional', () => {
  const result = validatePlan({ title: GOOD.title, seconds: GOOD.seconds, lines: GOOD.lines });
  assert.ok(result.ok);
  assert.deepEqual(result.plan.sources, []);
});

test('a caption chunk with four words is refused', () => {
  const plan = { ...GOOD, lines: [GOOD.lines[0], { ...GOOD.lines[1], caps: 'ONE TWO THREE *FOUR' }, GOOD.lines[2]] };
  assert.deepEqual(errorsOf(plan), ['Line 2, caption 1 has 4 words (1–3).']);
});

test('a chunk needs exactly one yellow word', () => {
  const none = { ...GOOD, lines: [{ ...GOOD.lines[0], caps: 'WHAT HAPPENS' }, ...GOOD.lines.slice(1)] };
  assert.deepEqual(errorsOf(none), ['Line 1, caption 1 needs one *yellow word.']);
  const two = { ...GOOD, lines: [{ ...GOOD.lines[0], caps: '*WHAT *HAPPENS' }, ...GOOD.lines.slice(1)] };
  assert.deepEqual(errorsOf(two), ['Line 1, caption 1 has 2 *yellow words (just one).']);
});

test('line counts outside 3–30 are refused', () => {
  assert.ok(errorsOf({ ...GOOD, lines: GOOD.lines.slice(0, 2) }).includes('A plan needs 3–30 lines.'));
  assert.ok(errorsOf({ ...GOOD, lines: Array.from({ length: 31 }, () => GOOD.lines[0]) }).includes('A plan needs 3–30 lines.'));
});

test('a missing title, bad length or empty line text is refused', () => {
  assert.ok(errorsOf({ ...GOOD, title: '  ' }).includes('The plan needs a title.'));
  assert.ok(errorsOf({ ...GOOD, seconds: 61 }).includes('The length must be 20–60 seconds.'));
  const empty = { ...GOOD, lines: [{ ...GOOD.lines[0], text: ' ' }, ...GOOD.lines.slice(1)] };
  assert.ok(errorsOf(empty).includes('Line 1 needs narration.'));
});

test('anything that isn’t a plan object is refused', () => {
  assert.equal(validatePlan(null).ok, false);
  assert.equal(validatePlan('plan').ok, false);
  assert.equal(validatePlan({ ...GOOD, lines: 'x' }).ok, false);
});
