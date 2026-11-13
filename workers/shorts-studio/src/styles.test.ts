import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseStyle, parseVoices } from './styles.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.STYLE.md`, import.meta.url), 'utf8');

test('a 2D style reads its name, tagline, length and example', () => {
  const style = parseStyle('inside-out', fixture('inside-out'), '{"voice": "am_michael"}', 2);
  assert.equal(style.name, 'Inside Out');
  assert.equal(style.tagline, 'flat 2D "What happens if…?" shorts');
  assert.equal(style.secondsMin, 25);
  assert.equal(style.secondsMax, 45);
  assert.equal(style.is3d, false);
  assert.equal(style.exampleTitle, 'WHAT IF YOU SWALLOW GUM?');
  assert.equal(style.bestFor, 'Quick 2D science explainers');
  assert.equal(style.position, 2);
});

test('a 3D style is marked 3D and takes the example’s voice', () => {
  const style = parseStyle('deep-dive', fixture('deep-dive'), '{"voice": "am_onyx"}', 0);
  assert.equal(style.name, 'Deep Dive 3D');
  assert.equal(style.is3d, true);
  assert.equal(style.secondsMin, 30);
  assert.equal(style.defaultVoice, 'am_onyx');
});

test('cozy tales reads its longer range', () => {
  const style = parseStyle('cozy-tales', fixture('cozy-tales'), '{"voice": "af_heart"}', 6);
  assert.equal(style.secondsMin, 40);
  assert.equal(style.secondsMax, 60);
  assert.equal(style.defaultVoice, 'af_heart');
});

test('an unknown style falls back without failing', () => {
  const style = parseStyle('new-one', '# Brand New: shiny things, 9:16\n\nNo format line.', 'not json', 9);
  assert.equal(style.name, 'Brand New');
  assert.equal(style.bestFor, 'shiny things');
  assert.equal(style.secondsMin, 30);
  assert.equal(style.defaultVoice, 'am_michael');
});

test('the voice list parses', () => {
  const voices = parseVoices('am_michael   US male, steady explainer (default)\naf_heart     US female, warm (best overall)\n\nnoise line\n');
  assert.deepEqual(voices, [
    { id: 'am_michael', label: 'US male, steady explainer (default)' },
    { id: 'af_heart', label: 'US female, warm (best overall)' },
  ]);
});
