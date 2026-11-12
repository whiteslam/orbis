import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ALL_MODULES } from '../locale/person.ts';
import { TABS } from './tabs.ts';
import { MODULES, parseModules, shownTab, visibleTabs } from './modules.ts';

test('visibleTabs keeps Today first and the chosen modules in tab order', () => {
  assert.deepEqual(visibleTabs(['money', 'journal']), ['today', 'money', 'journal']);
  assert.deepEqual(visibleTabs(['journal', 'money']), ['today', 'money', 'journal']);
});

test('visibleTabs with no modules is just Today', () => {
  assert.deepEqual(visibleTabs([]), ['today']);
});

test('visibleTabs with every module is every tab', () => {
  assert.deepEqual(visibleTabs(ALL_MODULES), TABS.map((t) => t.id));
});

test('shownTab falls back to Today for a hidden tab', () => {
  assert.equal(shownTab('social', ['money']), 'today');
  assert.equal(shownTab('money', ['money']), 'money');
  assert.equal(shownTab('today', []), 'today');
});

test('MODULES lists every module once, named as its tab', () => {
  assert.deepEqual(MODULES.map((m) => m.id), ALL_MODULES);
  for (const m of MODULES) assert.equal(m.label, TABS.find((t) => t.id === m.id)?.label);
});

test('parseModules accepts known ids, once each, in tab order', () => {
  assert.deepEqual(parseModules(['career', 'money', 'money']), ['money', 'career']);
  assert.deepEqual(parseModules([]), []);
});

test('parseModules rejects anything else', () => {
  assert.equal(parseModules(['money', 'today']), null);
  assert.equal(parseModules(['constructor']), null);
  assert.equal(parseModules('money'), null);
  assert.equal(parseModules([1]), null);
  assert.equal(parseModules(null), null);
});
