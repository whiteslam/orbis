import { test } from 'vitest';
import assert from 'node:assert/strict';
import { containerSpec, postedText, publishProblem, type PublishablePost } from './publish-rules.ts';

const post = (extra: Partial<PublishablePost> = {}): PublishablePost => ({
  status: 'ready', platforms: ['instagram', 'threads'], format: 'post', caption: 'Hello there', hashtags: ['one', 'two'],
  mediaPath: 'u/p/photo.jpg', mediaType: 'image', ...extra,
});
const ok = { connection: 'connected' as const, publication: null, dirty: false };

test('a ready JPEG post may go to Instagram and Threads', () => {
  assert.equal(publishProblem(post(), 'instagram', ok), null);
  assert.equal(publishProblem(post(), 'threads', ok), null);
});

test('connection comes first', () => {
  assert.equal(publishProblem(post(), 'instagram', { ...ok, connection: null }), 'Connect Instagram in Settings first.');
  assert.equal(publishProblem(post(), 'threads', { ...ok, connection: 'reconnect_required' }), 'Reconnect Threads in Settings.');
});

test('it must be saved and ready (or already out on the other platform)', () => {
  assert.equal(publishProblem(post(), 'instagram', { ...ok, dirty: true }), 'Save the post and mark it ready first.');
  assert.equal(publishProblem(post({ status: 'draft' }), 'instagram', ok), 'Save the post and mark it ready first.');
  assert.equal(publishProblem(post({ status: 'published' }), 'threads', ok), null);
});

test('the platform must be one of the post’s', () => {
  assert.equal(publishProblem(post({ platforms: ['threads'] }), 'instagram', ok), 'Add Instagram to this post’s platforms first.');
});

test('never twice', () => {
  assert.equal(publishProblem(post(), 'instagram', { ...ok, publication: 'published' }), 'Already published on Instagram.');
  assert.equal(publishProblem(post(), 'instagram', { ...ok, publication: 'processing' }), 'Publishing on Instagram is in progress.');
});

test('Instagram photos are JPEG only; Threads also takes PNG', () => {
  assert.equal(publishProblem(post({ mediaPath: 'u/p/a.png' }), 'instagram', ok), 'Instagram only accepts JPEG photos. Re-export it as .jpg.');
  assert.equal(publishProblem(post({ mediaPath: 'u/p/a.png' }), 'threads', ok), null);
  assert.equal(publishProblem(post({ mediaPath: 'u/p/a.webp' }), 'threads', ok), 'Threads doesn’t accept .webp files. Use a JPEG or PNG.');
  assert.equal(publishProblem(post({ mediaPath: 'u/p/a.gif' }), 'instagram', ok), 'Instagram only accepts JPEG photos. Re-export it as .jpg.');
  assert.equal(publishProblem(post({ mediaPath: 'u/p/a.webm', mediaType: 'video' }), 'instagram', ok), 'Instagram doesn’t accept .webm video. Use MP4 or MOV.');
  assert.equal(publishProblem(post({ mediaPath: 'u/p/a.mov', mediaType: 'video', format: 'reel' }), 'threads', ok), null);
});

test('media needs: Instagram always, Threads has no Stories', () => {
  assert.equal(publishProblem(post({ mediaPath: null, mediaType: null }), 'instagram', ok), 'Instagram needs a photo or video.');
  assert.equal(publishProblem(post({ mediaPath: null, mediaType: null }), 'threads', ok), null);
  assert.equal(publishProblem(post({ format: 'story' }), 'threads', ok), 'Threads has no Stories.');
});

test('length limits at their edges', () => {
  const tags: string[] = [];
  const at = (length: number) => post({ caption: 'x'.repeat(length), hashtags: tags });
  assert.equal(publishProblem(at(2200), 'instagram', ok), null);
  assert.equal(publishProblem(at(2201), 'instagram', ok), 'The text is 2,201 characters; Instagram allows 2,200.');
  assert.equal(publishProblem(at(500), 'threads', ok), null);
  assert.equal(publishProblem(at(501), 'threads', ok), 'The text is 501 characters; Threads allows 500.');
  assert.equal(publishProblem(post({ hashtags: Array.from({ length: 31 }, (_, i) => `t${i}`) }), 'instagram', ok), 'Instagram allows 30 hashtags; this post has 31.');
});

test('the text sent is the caption, a blank line, then the hashtags', () => {
  assert.equal(postedText('Hello', ['one', 'two']), 'Hello\n\n#one #two');
  assert.equal(postedText('Hello', []), 'Hello');
});

test('the container each format becomes', () => {
  assert.deepEqual(containerSpec(post(), 'instagram', 'https://s/a.jpg'), { kind: 'image', mediaUrl: 'https://s/a.jpg', text: 'Hello there\n\n#one #two' });
  assert.equal(containerSpec(post({ mediaPath: 'a.mp4', mediaType: 'video' }), 'instagram', 'u').kind, 'video');
  assert.equal(containerSpec(post({ format: 'reel', mediaPath: 'a.mp4', mediaType: 'video' }), 'threads', 'u').kind, 'video');
  assert.equal(containerSpec(post({ format: 'story' }), 'instagram', 'u').kind, 'story_image');
  assert.equal(containerSpec(post({ format: 'story', mediaPath: 'a.mp4', mediaType: 'video' }), 'instagram', 'u').kind, 'story_video');
  assert.deepEqual(containerSpec(post({ mediaPath: null, mediaType: null }), 'threads', null), { kind: 'text', text: 'Hello there\n\n#one #two' });
});
