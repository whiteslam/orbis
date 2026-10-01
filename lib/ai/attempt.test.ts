import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readAnthropicMessage, readCompletion } from './attempt';

const reply = (content: unknown, usage?: unknown) => JSON.stringify({ choices: [{ message: { content } }], ...(usage === undefined ? {} : { usage }) });

test('returns the text when the caller accepts it', () => {
  const read = readCompletion(reply('{"caption":"hi"}'), (text) => text.includes('caption'));
  assert.equal(read.kind, 'ok');
  assert.equal(read.kind === 'ok' && read.text, '{"caption":"hi"}');
});
test('a reply the caller cannot use is invalid, so the router tries the next model', () => {
  assert.equal(readCompletion(reply('not json'), () => false).kind, 'invalid');
});
test('empty or missing content is invalid without asking the caller', () => {
  let asked = false;
  assert.equal(readCompletion(reply('   '), () => { asked = true; return true; }).kind, 'invalid');
  assert.equal(readCompletion('{}').kind, 'invalid');
  assert.equal(asked, false);
});
test('a body that is not JSON is invalid rather than a crash', () => {
  assert.equal(readCompletion('<html>502</html>').kind, 'invalid');
});
test('a check that throws counts as a rejection', () => {
  assert.equal(readCompletion(reply('x'), () => { throw new Error('bad'); }).kind, 'invalid');
});
test('token usage is read from an OpenAI-compatible reply, on success and on rejection', () => {
  const usage = { prompt_tokens: 812, completion_tokens: 64, total_tokens: 876 };
  assert.deepEqual(readCompletion(reply('ok', usage)).usage, { inputTokens: 812, outputTokens: 64 });
  assert.deepEqual(readCompletion(reply('ok', usage), () => false).usage, { inputTokens: 812, outputTokens: 64 });
});
test('usage that is missing or nonsense is null, never a guess', () => {
  assert.equal(readCompletion(reply('ok')).usage, null);
  assert.equal(readCompletion(reply('ok', { prompt_tokens: -3, completion_tokens: 'many' })).usage, null);
});

const message = (text: string, extra: Record<string, unknown> = {}) => ({
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 900, output_tokens: 70 },
  ...extra,
});

test('a Claude reply gives its text and the tokens it reported', () => {
  const read = readAnthropicMessage(message('{"answer":"yes"}'), (text) => JSON.parse(text).answer === 'yes');
  assert.equal(read.kind, 'ok');
  assert.equal(read.kind === 'ok' && read.text, '{"answer":"yes"}');
  assert.deepEqual(read.usage, { inputTokens: 900, outputTokens: 70 });
});
test('JSON wrapped in a code fence is unwrapped, from any provider', () => {
  const fenced = '```json\n{"caption":"hi"}\n```';
  const accept = (text: string) => JSON.parse(text).caption === 'hi';
  assert.equal(readAnthropicMessage(message(fenced), accept).kind, 'ok');
  assert.equal(readCompletion(reply(fenced), accept).kind, 'ok');
});
test('text blocks are joined; other blocks are ignored', () => {
  const read = readAnthropicMessage({ ...message(''), content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }] });
  assert.equal(read.kind === 'ok' && read.text, '{"a":1}');
});
test('a refusal is invalid even when it carries text, and still reports usage', () => {
  const read = readAnthropicMessage(message('{"answer":"no"}', { stop_reason: 'refusal' }));
  assert.equal(read.kind, 'invalid');
  assert.deepEqual(read.usage, { inputTokens: 900, outputTokens: 70 });
});
test('a malformed message is invalid, not a crash', () => {
  assert.equal(readAnthropicMessage(null).kind, 'invalid');
  assert.equal(readAnthropicMessage({ content: 'nope' }).kind, 'invalid');
});
