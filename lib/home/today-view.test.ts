import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readTodayView, TODAY_VIEW_KEY } from './today-view.ts';

test('readTodayView keeps glass and classic', () => {
  assert.equal(readTodayView('glass'), 'glass');
  assert.equal(readTodayView('classic'), 'classic');
});

test('readTodayView returns classic for junk', () => {
  for (const raw of [null, '', 'Glass', 'grid']) assert.equal(readTodayView(raw), 'classic');
});

test('the storage key is stable', () => {
  assert.equal(TODAY_VIEW_KEY, 'orbis.today.view');
});
