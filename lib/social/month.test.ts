import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editUnreadies, indiaToday, monthGrid, monthName, monthSummary, overLimit, periodOf, periodOfDate, placePosts, readyProblem, shiftMonth, socialReminder } from './month.ts';
import type { SocialPost } from './types.ts';

const post = (over: Partial<SocialPost> = {}): SocialPost => ({
  id: 'p1', period: '2026-09-01', title: 'Launch', headline: null, caption: 'Hello', hashtags: [], format: 'post',
  platforms: ['instagram'], plannedFor: '2026-09-14', status: 'draft', mediaPath: null, mediaType: null, mediaUrl: null,
  published: null, source: 'manual', position: 0, updatedAt: '2026-09-01T00:00:00Z', ...over,
});

test('indiaToday reads the date in Asia/Kolkata, not UTC', () => {
  // 20:00 UTC on 30 September is already 1 October in India.
  assert.equal(indiaToday(new Date('2026-09-30T20:00:00Z')), '2026-10-01');
  assert.equal(indiaToday(new Date('2026-09-30T10:00:00Z')), '2026-09-30');
});

test('periodOf pads the month', () => {
  assert.equal(periodOf(2026, 9), '2026-09-01');
  assert.equal(periodOf(2026, 12), '2026-12-01');
});

test('monthName reads the period in words', () => {
  assert.equal(monthName('2026-09-01'), 'September 2026');
});

test('periodOfDate finds the month a day belongs to', () => {
  assert.equal(periodOfDate('2026-09-30'), '2026-09-01');
});

test('shiftMonth wraps the year both ways', () => {
  assert.equal(shiftMonth('2026-12-01', 1), '2027-01-01');
  assert.equal(shiftMonth('2026-01-01', -1), '2025-12-01');
  assert.equal(shiftMonth('2026-09-01', 1), '2026-10-01');
});

test('monthGrid starts on the Monday before the first and is rectangular', () => {
  const grid = monthGrid('2026-09-01');
  assert.equal(grid.length, 5);
  assert.deepEqual(grid[0][0], { date: '2026-08-31', inMonth: false });
  assert.deepEqual(grid[0][1], { date: '2026-09-01', inMonth: true });
  assert.ok(grid.every((week) => week.length === 7));
  assert.equal(grid.flat().filter((day) => day.inMonth).length, 30);
});

test('monthGrid uses six rows when the month needs them', () => {
  // August 2026 starts on a Saturday and has 31 days.
  assert.equal(monthGrid('2026-08-01').length, 6);
});

test('placePosts groups by day and keeps undated posts aside', () => {
  const placed = placePosts([post({ id: 'a' }), post({ id: 'b' }), post({ id: 'c', plannedFor: null })]);
  assert.equal(placed.byDay.get('2026-09-14')?.length, 2);
  assert.deepEqual(placed.undated.map((item) => item.id), ['c']);
});

test('readyProblem names each missing piece', () => {
  assert.equal(readyProblem(post({ title: '  ' })), 'Give the post a title.');
  assert.equal(readyProblem(post({ caption: '' })), 'Write a caption first.');
  assert.equal(readyProblem(post({ plannedFor: null })), 'Pick a day for this post.');
  assert.equal(readyProblem(post({ plannedFor: '2026-10-01' })), 'Pick a day inside this month.');
  assert.equal(readyProblem(post({ format: 'reel' })), 'Add a picture or video — reels need one.');
  assert.equal(readyProblem(post({ format: 'story' })), 'Add a picture or video — stories need one.');
});

test('readyProblem passes a complete post', () => {
  assert.equal(readyProblem(post()), null);
  assert.equal(readyProblem(post({ format: 'reel', mediaPath: 'u/p/x.mp4' })), null);
});

test('overLimit flags X at 281 characters', () => {
  assert.deepEqual(overLimit('a'.repeat(280), [], ['x', 'instagram']), []);
  assert.deepEqual(overLimit('a'.repeat(281), [], ['x', 'instagram']), ['x']);
});

test('overLimit counts hashtags as they will be posted', () => {
  // 270 + "\n\n" + "#tagtag #tagtag" (15) = 287
  assert.deepEqual(overLimit('a'.repeat(270), ['tagtag', 'tagtag'], ['x']), ['x']);
});

test('monthSummary says so when nothing is planned', () => {
  assert.equal(monthSummary([]), 'Nothing planned yet');
});

test('monthSummary counts ready and published', () => {
  const posts = [post(), post({ status: 'ready' }), post({ status: 'published', published: { at: 'x', platform: 'instagram', link: null } })];
  assert.equal(monthSummary(posts), '3 posts · 1 ready · 1 published');
  assert.equal(monthSummary([post()]), '1 post');
});

test('socialReminder says nothing when nothing is due', () => {
  assert.equal(socialReminder([], '2026-09-14'), '');
  assert.equal(socialReminder([post({ status: 'published', published: { at: 'x', platform: 'x', link: null } })], '2026-09-14'), '');
  assert.equal(socialReminder([post({ plannedFor: '2026-09-15' })], '2026-09-14'), '');
});

test('socialReminder batches the day into one line', () => {
  assert.equal(socialReminder([post({ status: 'ready' }), post({ status: 'ready' })], '2026-09-14'), '2 posts planned for today, all ready to go.');
  assert.equal(socialReminder([post(), post({ status: 'ready' })], '2026-09-14'), '2 posts planned for today — 1 not ready yet.');
  assert.equal(socialReminder([post({ format: 'reel' }), post({ status: 'ready' })], '2026-09-14'), '2 posts planned for today — 1 still needs a picture or video.');
  assert.equal(socialReminder([post()], '2026-09-14'), '1 post planned for today — not ready yet.');
});

test('editUnreadies is true only for caption, title, media or format changes', () => {
  const before = post({ status: 'ready' });
  assert.equal(editUnreadies(before, { caption: 'Changed' }), true);
  assert.equal(editUnreadies(before, { title: 'New' }), true);
  assert.equal(editUnreadies(before, { mediaPath: 'u/p/a.jpg' }), true);
  assert.equal(editUnreadies(before, { format: 'reel' }), true);
  assert.equal(editUnreadies(before, { caption: 'Hello' }), false);
  assert.equal(editUnreadies(before, { hashtags: ['x'] }), false);
});
