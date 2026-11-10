#!/usr/bin/env node
// A stand-in for `claude -p` in the worker's tests: reads the prompt on stdin,
// prints stream-json like Claude Code does and leaves the files the real run
// would. FAKE_MODE: good (default) · bad-plan · login · slow.

import { mkdirSync, writeFileSync } from 'node:fs';

const mode = process.env.FAKE_MODE ?? 'good';
const say = (content) => process.stdout.write(`${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content } })}\n`);
const bash = (command) => ({ type: 'tool_use', id: `t${Math.random()}`, name: 'Bash', input: { command } });
const result = (isError, text) => process.stdout.write(`${JSON.stringify({ type: 'result', subtype: isError ? 'error_during_execution' : 'success', is_error: isError, result: text })}\n`);

let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { prompt += chunk; });
process.stdin.on('end', async () => {
  if (mode === 'login') {
    process.stderr.write('Invalid API key · Please run /login\n');
    process.exit(1);
  }
  if (mode === 'slow') await new Promise((resolve) => setTimeout(resolve, 10_000));

  if (/Stop after plan\.json is written|failed these checks/.test(prompt)) {
    say([{ type: 'text', text: 'Writing the script and the plan.' }]);
    const line = (n) => ({ text: `Line ${n} of the story.`, caps: mode === 'bad-plan' ? 'TOO MANY WORDS HERE' : `LINE *${n}`, shot: `Shot ${n}` });
    writeFileSync('plan.json', JSON.stringify({ title: 'Fake Short', seconds: 30, lines: [1, 2, 3].map(line), sources: ['A source'] }));
    result(false, 'Plan written.');
    return;
  }

  say([{ type: 'text', text: 'Timing the voice.' }, bash('/skill/scripts/py /skill/scripts/voice.py .')]);
  say([bash('node tools/capture.mjs check')]);
  say([{ type: 'text', text: 'QA: the caption hit the hand at 4.2 s, moved the hand.' }, bash('node tools/capture.mjs sheet review/all.jpg 0.5 10')]);
  say([bash('node tools/capture.mjs video renders/short.mp4')]);
  mkdirSync('renders', { recursive: true });
  mkdirSync('review', { recursive: true });
  writeFileSync('renders/short.mp4', 'not really a video');
  writeFileSync('renders/cover.jpg', 'jpg');
  writeFileSync('review/all.jpg', 'jpg');
  writeFileSync('delivery.json', JSON.stringify({ title: 'Fake Short', caption: 'A caption', hashtags: ['fake', 'shorts'], qa: ['moved the hand'] }));
  result(false, 'Done.');
});
