import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefSystemPrompt, cleanCaption, parseBrief } from './style.ts';

const LONG = 'Gym is in 8 minutes, at 7 pm. Rain showers out there right now, 24 degrees and feeling like 27.';

test('both surfaces are written from one prompt, differing only in length', () => {
  const note = briefSystemPrompt('note');
  const push = briefSystemPrompt('push');

  // The rules that keep a brief honest must be identical, or the push and the
  // app can disagree about the same day.
  for (const rule of [
    'never compute, estimate, round or invent',
    'rainPeak is the wettest hour in the next 12 hours',
    'dayCoverage is at least 60%',
    'Never use an em dash',
    'British English',
  ]) {
    assert.ok(note.includes(rule), `note prompt lost: ${rule}`);
    assert.ok(push.includes(rule), `push prompt lost: ${rule}`);
  }

  assert.match(note, /25 to 40 words/);
  assert.match(push, /15 to 30 words/);
  assert.match(push, /title is at most 50 characters/);
  assert.ok(!note.includes('title'), 'the note has no title, only a caption');
});

test('em dashes are rewritten rather than trusted to the prompt', () => {
  const parsed = cleanCaption(`Rain is likely around 9 pm — 80% — so move things earlier. ${LONG}`, 'note');
  assert.ok(parsed);
  assert.ok(!/[—–]/.test(parsed));
  assert.match(parsed, /around 9 pm, 80%, so move things earlier/);
  assert.ok(!/,\s*,/.test(parsed), 'no doubled commas');
  assert.ok(!/\s[,.;:]/.test(parsed), 'no space before punctuation');
});

test('a push is allowed to be shorter than a note', () => {
  const brief = 'Gym is at 7 pm, and it is raining.';
  assert.equal(cleanCaption(brief, 'push')?.length, brief.length);
  assert.equal(cleanCaption(brief, 'note'), null, 'too short to be the note');
});

test('each surface is capped to what its space allows', () => {
  assert.equal(cleanCaption('x'.repeat(900), 'note')?.length, 260);
  assert.equal(cleanCaption('x'.repeat(900), 'push')?.length, 180);
});

test('a list or a heading is not a brief, whatever field it arrives in', () => {
  assert.equal(parseBrief(JSON.stringify({ caption: `- ${LONG}` }), 'note'), null);
  assert.equal(parseBrief(JSON.stringify({ caption: `# ${LONG}` }), 'note'), null);
  assert.equal(parseBrief(JSON.stringify({ caption: `${LONG}\n- and a bullet` }), 'note'), null);
});

test('the push title is taken when offered and dropped when unusable', () => {
  const withTitle = parseBrief(JSON.stringify({ title: '  Gym at 7  ', caption: LONG }), 'push');
  assert.equal(withTitle?.title, 'Gym at 7');
  assert.equal(parseBrief(JSON.stringify({ title: '   ', caption: LONG }), 'push')?.title, null);
  assert.equal(parseBrief(JSON.stringify({ title: 'x'.repeat(90), caption: LONG }), 'push')?.title?.length, 50);
});

test('an unusable reply returns null so Orbis’s own wording stays', () => {
  assert.equal(parseBrief('not json', 'note'), null);
  assert.equal(parseBrief(JSON.stringify({ caption: '' }), 'note'), null);
  assert.equal(parseBrief(JSON.stringify({ caption: 42 }), 'note'), null);
  assert.equal(parseBrief(JSON.stringify({ paragraphs: [LONG] }), 'note'), null, 'an older shape is not accepted');
});
