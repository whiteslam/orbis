import { test } from 'vitest';
import assert from 'node:assert/strict';
import { cleanBlock, cleanList, cleanNullable, cleanNumber, cleanText, isRecord, readJson, readJsonObject, unfence } from './json.ts';

test('unfence takes off a Markdown fence, with or without a language', () => {
  assert.equal(unfence('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(unfence('```\n[1]\n```'), '[1]');
  assert.equal(unfence('  {"a":1}  '), '{"a":1}');
  // A model that opens a fence and runs out of tokens still gets read.
  assert.equal(unfence('```json\n{"a":1}'), '{"a":1}');
});

test('readJson reads any JSON value, and an object out of a chatty reply', () => {
  assert.deepEqual(readJson('```json\n[{"a":1}]\n```'), [{ a: 1 }]);
  assert.deepEqual(readJson('Here you go: {"a": {"b": 2}} Hope that helps'), { a: { b: 2 } });
  assert.equal(readJson('nothing'), null);
  assert.equal(readJson('{not json}'), null);
});

test('readJsonObject takes the object out of a fenced or chatty reply', () => {
  assert.deepEqual(readJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(readJsonObject('Sure! {"a": {"b": 2}}'), { a: { b: 2 } });
  assert.equal(readJsonObject('[1,2]'), null);
  assert.equal(readJsonObject('"text"'), null);
  assert.equal(readJsonObject('{not json}'), null);
  assert.equal(readJsonObject('nothing'), null);
});

test('isRecord accepts plain objects only', () => {
  assert.equal(isRecord({}), true);
  assert.equal(isRecord([]), false);
  assert.equal(isRecord(null), false);
  assert.equal(isRecord('x'), false);
});

test('single-line text is trimmed, single-spaced and capped', () => {
  assert.equal(cleanText('  a \n  b ', 10), 'a b');
  assert.equal(cleanText('abcdef', 3), 'abc');
  assert.equal(cleanText(5, 10), '');
  assert.equal(cleanNullable('   ', 10), null);
  assert.equal(cleanNullable(' x ', 10), 'x');
});

test('block text keeps its line breaks', () => {
  assert.equal(cleanBlock('  Hello,\n\nThanks.  ', 100), 'Hello,\n\nThanks.');
  assert.equal(cleanBlock('abcdef', 3), 'abc');
  assert.equal(cleanBlock('  ', 10), null);
  assert.equal(cleanBlock(3, 10), null);
});

test('lists are unique, non-empty and capped', () => {
  assert.deepEqual(cleanList(['x', ' x ', '', 3, 'y', 'z'], 2, 5), ['x', 'y']);
  assert.deepEqual(cleanList(['abcdef'], 5, 3), ['abc']);
  assert.deepEqual(cleanList('x', 5, 3), []);
});

test('numbers must be finite and in range', () => {
  assert.equal(cleanNumber('4.6', 0, 10, true), 5);
  assert.equal(cleanNumber(4.6, 0, 10), 4.6);
  assert.equal(cleanNumber(11, 0, 10), null);
  assert.equal(cleanNumber(Number.NaN, 0, 10), null);
  assert.equal(cleanNumber(null, 0, 10), null);
});
