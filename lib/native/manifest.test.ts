import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The play build must never ask for these (Global Constraints). This test covers
// three layers:
// - source manifests play can merge (app main, orbis-core main) never name them;
// - the play flavour manifest strips each one with tools:node="remove", so a
//   library can't bring one in transitively, and names them only as removes;
// - when a Gradle build has run, the merged play manifests contain none of them.
// Direct-only permissions live in android/app/src/direct/AndroidManifest.xml,
// which play never merges, so this test does not read it.
const FORBIDDEN = [
  'READ_SMS',
  'READ_CALL_LOG',
  'BIND_ACCESSIBILITY_SERVICE',
  'QUERY_ALL_PACKAGES',
  'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
];

const root = process.cwd();
const MAIN = 'android/app/src/main/AndroidManifest.xml';
const ORBIS_CORE = 'android/orbis-core/src/main/AndroidManifest.xml';
const PLAY = 'android/app/src/play/AndroidManifest.xml';
const INTERMEDIATES = 'android/app/build/intermediates';
// AGP 8 writes play manifests under these folders, one subfolder per play variant.
const MERGED_DIRS = ['merged_manifest', 'merged_manifests', 'packaged_manifests'];

const read = (file: string) => readFileSync(join(root, file), 'utf8');
const mentions = (xml: string, permission: string) => new RegExp(`\\b${permission}\\b`).test(xml);
const usesPermissions = (xml: string) => xml.match(/<uses-permission\b[^>]*>/g) ?? [];

function manifestsUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...manifestsUnder(path));
    else if (entry.name === 'AndroidManifest.xml') out.push(path);
  }
  return out;
}

function mergedPlayManifests(): string[] {
  const files: string[] = [];
  for (const kind of MERGED_DIRS) {
    const dir = `${INTERMEDIATES}/${kind}`;
    if (!existsSync(join(root, dir))) continue;
    for (const variant of readdirSync(join(root, dir))) {
      if (variant.startsWith('play')) files.push(...manifestsUnder(`${dir}/${variant}`));
    }
  }
  return files;
}

test('the main manifest exists', () => {
  assert.ok(existsSync(join(root, MAIN)), `${MAIN} is missing`);
});

test('no source manifest play merges names a forbidden permission', () => {
  const files = [MAIN, ...(existsSync(join(root, ORBIS_CORE)) ? [ORBIS_CORE] : [])];
  for (const file of files) {
    const xml = read(file);
    for (const permission of FORBIDDEN) {
      assert.ok(!mentions(xml, permission), `${file} contains ${permission}`);
    }
  }
});

test('the play manifest removes every forbidden permission, and names them only as removes', () => {
  assert.ok(existsSync(join(root, PLAY)), `${PLAY} is missing`);
  const xml = read(PLAY);
  assert.match(xml, /xmlns:tools="http:\/\/schemas\.android\.com\/tools"/);
  const elements = usesPermissions(xml);
  for (const permission of FORBIDDEN) {
    const named = elements.filter((element) => element.includes(`"android.permission.${permission}"`));
    assert.ok(named.length > 0, `${PLAY} has no remove entry for ${permission}`);
    for (const element of named) assert.match(element, /tools:node="remove"/, `${PLAY} names ${permission} without removing it`);
    // Outside those uses-permission removes, the name appears nowhere (no service permission, no comment slip).
    const rest = elements.reduce((text, element) => text.replace(element, ''), xml);
    assert.ok(!mentions(rest, permission), `${PLAY} names ${permission} outside a remove entry`);
  }
});

test('the merged play manifests contain no forbidden permission', (context) => {
  const files = mergedPlayManifests();
  if (files.length === 0) {
    context.skip('no Gradle output: run `cd android && ./gradlew assemblePlayDebug` to check the merged play manifest');
    return;
  }
  for (const file of files) {
    const xml = read(file);
    for (const permission of FORBIDDEN) {
      assert.ok(!mentions(xml, permission), `${file} contains ${permission}`);
    }
  }
});

test('the WebView tells the site it is the Android app', () => {
  const config = read('capacitor.config.ts');
  assert.ok(config.includes("appendUserAgent: 'OrbisAndroid'"), 'capacitor.config.ts must append OrbisAndroid to the user agent');
});
