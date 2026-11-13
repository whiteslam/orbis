import { test } from 'vitest';
import assert from 'node:assert/strict';
import { checkPublished, parseQueueFile, planAll, planImport, readPublished, readQueueFile, readYouTubeJson } from './import-youtube-queue.ts';

const OWNER = '1234abcd-0000-4000-8000-000000000001';
const path = (project: string, file: string) => `${OWNER}/imported/${project}/${file}`;

test('keeps queue order and skips published projects', () => {
  const queue = readQueueFile(['alpha', { project: 'beta' }, { dir: 'gamma' }, { name: 'delta' }]);
  assert.deepEqual(queue, ['alpha', 'beta', 'gamma', 'delta']);
  const published = readPublished([{ project: 'beta' }, 'delta']);
  assert.deepEqual(planImport(queue, published, new Set(), OWNER), [
    { project: 'alpha', videoPath: path('alpha', 'video.mp4'), coverPath: path('alpha', 'cover.jpg') },
    { project: 'gamma', videoPath: path('gamma', 'video.mp4'), coverPath: path('gamma', 'cover.jpg') },
  ]);
});

test('a re-run plans nothing when every video_path is already queued', () => {
  const queue = ['alpha', 'beta'];
  const queued = new Set([path('alpha', 'video.mp4'), path('beta', 'video.mp4')]);
  assert.deepEqual(planImport(queue, new Set(), queued, OWNER), []);
  // One new project among them still comes through, in order.
  assert.deepEqual(planImport(['alpha', 'gamma'], new Set(), queued, OWNER).map((item) => item.project), ['gamma']);
});

test('reads youtube.json in either key style and falls back to the folder name for a missing title', () => {
  const camel = readYouTubeJson({ title: 'Why <b>cats</b> purr', description: 'Purr.', tags: ['cats', '#pets'], categoryId: '27', privacyStatus: 'unlisted', madeForKids: true }, 'cats-purr');
  assert.deepEqual(camel, { title: 'Why bcats/b purr', description: 'Purr.', tags: ['cats', 'pets'], categoryId: '27', privacy: 'unlisted', madeForKids: true });
  const snake = readYouTubeJson({ description: 'x', tags: 'a, b', category_id: 22, privacy: 'private', made_for_kids: false }, 'folder-name');
  assert.equal(snake.title, 'folder-name');
  assert.deepEqual(snake.tags, ['a', 'b']);
  assert.equal(snake.categoryId, '22');
  assert.equal(snake.privacy, 'private');
  assert.equal(snake.madeForKids, false);
  // Nothing said about privacy or category: the Orbis defaults.
  const bare = readYouTubeJson({}, 'bare');
  assert.equal(bare.privacy, 'public');
  assert.equal(bare.categoryId, '24');
  assert.equal(bare.madeForKids, false);
  // A value that cannot be right is refused, not guessed.
  assert.throws(() => readYouTubeJson({ privacyStatus: 'everyone' }, 'x'), /privacy/);
  assert.throws(() => readYouTubeJson({ title: '   ' }, ' '), /title/);
  assert.throws(() => readYouTubeJson('nope', 'x'), /object/);
});

test('an unreadable queue entry is skipped and reported', () => {
  const parsed = parseQueueFile(['alpha', 42, null, { id: 7 }, '', { project: 'beta' }, ['x']]);
  assert.deepEqual(parsed.projects, ['alpha', 'beta']);
  assert.equal(parsed.unreadable.length, 5);
  assert.match(parsed.unreadable[0], /#2/);
  assert.throws(() => parseQueueFile('not a list'), /list/);
  assert.deepEqual(parseQueueFile({ queue: ['a'] }).projects, ['a']);
});

test('project names become safe storage paths', () => {
  const [item] = planImport(['/home/me/faceless-shorts/My Short: v2!'], new Set(), new Set(), OWNER);
  assert.equal(item.videoPath, path('My_Short__v2_', 'video.mp4'));
  const [odd] = planImport(['..'], new Set(), new Set(), OWNER);
  assert.ok(!odd.videoPath.includes('/../'));
  assert.ok(!odd.videoPath.includes('imported/./'));
  // Two projects that end up with the same path: the second is left out, not overwritten, and the reason names the first.
  assert.deepEqual(planImport(['a b', 'a_b'], new Set(), new Set(), OWNER).map((item) => item.project), ['a b']);
  assert.deepEqual(planAll(['a b', 'a_b'], new Set(), new Set(), OWNER).map((item) => item.skip), [null, 'same folder name as a b']);
  assert.equal(planAll(['a'], new Set(), new Set([path('a', 'video.mp4')]), OWNER)[0].skip, 'already queued');
});

test('a published.json entry that cannot be read blocks --apply', () => {
  const published = parseQueueFile(['alpha', { slug: 'beta' }, 7]);
  const check = checkPublished(published, ['alpha', 'beta', 'gamma'], []);
  assert.equal(check.blocking, true);
  assert.equal(check.notes.length, 2);
  assert.match(check.notes[0], /^published\.json: entry #2/);
  // Everything readable and matching: fine.
  assert.deepEqual(checkPublished(parseQueueFile(['alpha']), ['alpha', 'gamma'], []), { notes: [], blocking: false });
});

test('a published list that matches no queued project or folder blocks --apply', () => {
  const wrong = checkPublished(parseQueueFile(['dQw4w9WgXcQ', 'abc123']), ['alpha', 'beta'], ['alpha', 'beta', 'old-one']);
  assert.equal(wrong.blocking, true);
  assert.match(wrong.notes[0], /none of its names match/);
  // Published projects that have left the queue still match their folder.
  assert.equal(checkPublished(parseQueueFile(['old-one']), ['alpha'], ['alpha', 'old-one']).blocking, false);
  // Paths are compared by folder name; an empty published list is fine.
  assert.equal(checkPublished(parseQueueFile(['/home/me/faceless-shorts/alpha']), ['alpha'], []).blocking, false);
  assert.equal(checkPublished(parseQueueFile([]), ['alpha'], []).blocking, false);
});
