import { test } from 'vitest';
import assert from 'node:assert/strict';
import { LOG_MAX, needsAttention, resultOf, stepForCommand, stepsFromStreamLine } from './stream.ts';

const assistant = (...content: unknown[]) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content } });
const bash = (command: string) => ({ type: 'tool_use', id: 't1', name: 'Bash', input: { command } });

test('each skill command maps to its step', () => {
  assert.equal(stepForCommand('bash ~/.claude/skills/faceless-shorts/scripts/new_video.sh inside-out gum --dir ~/faceless-shorts'), 'Setting up the project');
  assert.equal(stepForCommand('SKILL/scripts/py SKILL/scripts/voice.py .'), 'Recording the voice');
  assert.equal(stepForCommand('SKILL/scripts/py SKILL/scripts/voice.py --list'), null);
  assert.equal(stepForCommand('SKILL/scripts/py SKILL/scripts/words.py .'), 'Timing every word');
  assert.equal(stepForCommand('node tools/capture.mjs check'), 'Checking the shots');
  assert.equal(stepForCommand('node tools/capture.mjs sheet review/all.jpg 0.5 10'), 'QA: checking every frame');
  assert.equal(stepForCommand('SOFTWARE_GL=1 node tools/capture.mjs video renders/short.mp4'), 'Rendering the video');
  assert.equal(stepForCommand('ls -la'), null);
});

test('a stream line gives its steps and Claude’s words', () => {
  const steps = stepsFromStreamLine(assistant({ type: 'text', text: 'Writing the   script now.' }, bash('node tools/capture.mjs cues')));
  assert.deepEqual(steps, [
    { kind: 'log', content: 'Writing the script now.' },
    { kind: 'step', content: 'Placing sound cues' },
  ]);
});

test('QA notes are marked as QA', () => {
  assert.deepEqual(stepsFromStreamLine(assistant({ type: 'text', text: 'QA: the gum crossed the caption at 4.2 s, moved it up.' })), [
    { kind: 'qa', content: 'QA: the gum crossed the caption at 4.2 s, moved it up.' },
  ]);
});

test('long text is cut, and other lines give nothing', () => {
  const [step] = stepsFromStreamLine(assistant({ type: 'text', text: 'x'.repeat(5000) }));
  assert.equal(step.content.length, LOG_MAX);
  assert.deepEqual(stepsFromStreamLine('{"type":"user","message":{"content":[]}}'), []);
  assert.deepEqual(stepsFromStreamLine('not json'), []);
  assert.deepEqual(stepsFromStreamLine(assistant(bash('cat script.json'))), []);
});

test('the result line is read', () => {
  assert.deepEqual(resultOf('{"type":"result","subtype":"success","is_error":false,"result":"Done"}'), { isError: false, text: 'Done' });
  assert.equal(resultOf('{"type":"result","subtype":"error_max_turns","is_error":true}')?.isError, true);
  assert.equal(resultOf(assistant()), null);
});

test('login and usage problems are spotted', () => {
  assert.equal(needsAttention('Invalid API key · Please run /login'), true);
  assert.equal(needsAttention('Claude AI usage limit reached|1731234567'), true);
  assert.equal(needsAttention('Rendering finished in 4 minutes.'), false);
});
