import { test } from 'vitest';
import assert from 'node:assert/strict';
import { safePushPath } from './push-path';

test('a same-site path is followed', () => {
  assert.equal(safePushPath('/?notifications=open'), '/?notifications=open');
  assert.equal(safePushPath('/active#money'), '/active#money');
  assert.equal(safePushPath('/active/research'), '/active/research');
});

test('an absolute or third-party address is refused', () => {
  assert.equal(safePushPath('https://evil.example/'), null);
  assert.equal(safePushPath('//evil.example/'), null);
  assert.equal(safePushPath('/\\evil.example/'), null);
  assert.equal(safePushPath('\\\\evil.example/'), null);
  assert.equal(safePushPath('javascript:alert(1)'), null);
  assert.equal(safePushPath('active'), null);
});

test('a path that the URL parser would turn into another site is refused', () => {
  assert.equal(safePushPath('/\t/evil.example/'), null);
  assert.equal(safePushPath('/\n/evil.example/'), null);
  assert.equal(safePushPath(' /active'), null);
});

test('anything that is not a short string is refused', () => {
  assert.equal(safePushPath(undefined), null);
  assert.equal(safePushPath(null), null);
  assert.equal(safePushPath(42), null);
  assert.equal(safePushPath(''), null);
  assert.equal(safePushPath(`/${'a'.repeat(2048)}`), null);
});
