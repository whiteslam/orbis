import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { project, rubberband, settleTime, springAt, springEasing, SPRINGS } from './spring';

test('a critically damped spring never overshoots and comes to rest at 1', () => {
  let peak = 0;
  for (let t = 0; t < 1.5; t += 0.005) peak = Math.max(peak, springAt(t, SPRINGS.smooth));
  assert.ok(peak <= 1.0001, `peaked at ${peak}`);
  assert.ok(Math.abs(springAt(settleTime(SPRINGS.smooth), SPRINGS.smooth) - 1) < 0.002);
});

test('the bouncy spring overshoots a little, and only a little', () => {
  let peak = 0;
  for (let t = 0; t < 1.5; t += 0.005) peak = Math.max(peak, springAt(t, SPRINGS.bouncy));
  assert.ok(peak > 1.005 && peak < 1.05, `peaked at ${peak}`);
});

test('a faster response settles sooner, and a head start carries it further early on', () => {
  assert.ok(settleTime(SPRINGS.snappy) < settleTime(SPRINGS.smooth));
  assert.ok(springAt(0.05, SPRINGS.smooth, 4) > springAt(0.05, SPRINGS.smooth, 0));
});

test('linear() easings start at 0, end at 1, and keep their stops in order', () => {
  const { easing, ms } = springEasing(SPRINGS.smooth);
  assert.match(easing, /^linear\(0, .+, 1\)$/);
  const percents = [...easing.matchAll(/ ([\d.]+)%/g)].map((match) => Number(match[1]));
  assert.deepEqual(percents, [...percents].sort((a, b) => a - b));
  assert.ok(ms > 300 && ms < 900, `${ms}ms`);
});

test('a flick projects ahead in its direction, and rubber-banding gives less than was pulled', () => {
  assert.ok(project(1000) > 400);
  assert.ok(project(-1000) < -400);
  assert.ok(rubberband(200, 800) < 200);
  assert.ok(rubberband(200, 800) > 0);
});

// The stylesheets can't import TypeScript, so brand.css carries the springs
// as literal tokens. This keeps them the generator's output: if it fails,
// paste the expected lines into brand.css.
test('the --spring tokens in brand.css match SPRINGS', () => {
  const css = readFileSync(new URL('../../app/styles/brand.css', import.meta.url), 'utf8');
  const names = { smooth: '--spring', snappy: '--spring-snappy', bouncy: '--spring-bouncy' } as const;
  for (const [key, token] of Object.entries(names)) {
    const { easing, ms } = springEasing(SPRINGS[key as keyof typeof SPRINGS]);
    assert.ok(css.includes(`${token}: ${easing};`), `expected in brand.css:\n  ${token}: ${easing};`);
    assert.ok(css.includes(`${token}-dur: ${ms}ms;`), `expected in brand.css:\n  ${token}-dur: ${ms}ms;`);
  }
});
