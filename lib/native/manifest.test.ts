import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The play build must never ask for these. Direct-only permissions live in
// android/app/src/direct/AndroidManifest.xml, which this test does not read.
const FORBIDDEN = [
  'READ_SMS',
  'READ_CALL_LOG',
  'BIND_ACCESSIBILITY_SERVICE',
  'QUERY_ALL_PACKAGES',
  'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
];

const root = process.cwd();
const MAIN = 'android/app/src/main/AndroidManifest.xml';
const OPTIONAL = ['android/app/src/play/AndroidManifest.xml', 'android/orbis-core/src/main/AndroidManifest.xml'];

test('the main manifest exists', () => {
  assert.ok(existsSync(join(root, MAIN)), `${MAIN} is missing`);
});

test('no play-reachable manifest asks for a forbidden permission', () => {
  const files = [MAIN, ...OPTIONAL.filter((file) => existsSync(join(root, file)))];
  for (const file of files) {
    const xml = readFileSync(join(root, file), 'utf8');
    for (const permission of FORBIDDEN) {
      assert.doesNotMatch(xml, new RegExp(`\\b${permission}\\b`), `${file} contains ${permission}`);
    }
  }
});

test('the WebView tells the site it is the Android app', () => {
  const config = readFileSync(join(root, 'capacitor.config.ts'), 'utf8');
  assert.ok(config.includes("appendUserAgent: 'OrbisAndroid'"), 'capacitor.config.ts must append OrbisAndroid to the user agent');
});
