import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushTopic } from './topic.ts';

// Apple Web Push validates the Topic header as base64url and answers 400
// BadWebPushTopic otherwise. A base64 string can never be one character longer
// than a multiple of four, which is what silently dropped two of the four daily
// notifications on every iPhone.
const validBase64Url = (value: string) => /^[A-Za-z0-9_-]+$/.test(value) && value.length % 4 !== 1;

test('every tag the app sends produces a topic Apple accepts', () => {
  for (const slot of ['morning', 'lunch', 'evening', 'night', 'test']) {
    const topic = pushTopic(`orbis-${slot}`);
    assert.ok(validBase64Url(topic), `orbis-${slot} produced an invalid topic: ${topic}`);
    assert.ok(topic.length <= 32);
  }
});

test('the raw tags were the bug, and are no longer used as the topic', () => {
  // The two that failed: 13 characters, so 13 % 4 === 1.
  assert.ok(!validBase64Url('orbis-morning'));
  assert.ok(!validBase64Url('orbis-evening'));
  // And the two that happened to work, which is why it looked intermittent.
  assert.ok(validBase64Url('orbis-lunch'));
  assert.ok(validBase64Url('orbis-night'));
});

test('a long tag cannot reintroduce it through truncation', () => {
  for (let length = 1; length <= 60; length += 1) {
    const topic = pushTopic('x'.repeat(length));
    assert.ok(validBase64Url(topic), `length ${length} produced ${topic}`);
    assert.ok(topic.length <= 32, `length ${length} produced ${topic.length} characters`);
  }
});

test('different tags stay distinct, so one topic cannot replace another', () => {
  const topics = ['morning', 'lunch', 'evening', 'night'].map((slot) => pushTopic(`orbis-${slot}`));
  assert.equal(new Set(topics).size, topics.length);
});
