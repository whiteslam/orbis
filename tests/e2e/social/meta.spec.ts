import { expect, openApp, openTab, test } from '../support/fixtures';

const live = (externalId: string, postId: string | null) => ({
  platforms: [{
    platform: 'instagram', username: 'orbis_test', state: 'ok', matchedPostIds: [],
    posts: [{ externalId, caption: 'Shared outside the plan', permalink: 'https://www.instagram.com/p/x/', timestamp: '2026-09-21T04:30:00+0000', productType: 'FEED', thumbnail: null, stats: { reach: 1200, likes: 84, comments: 6, saves: 3 } }],
    publications: postId ? { [externalId]: postId } : {},
  }],
});

test('the month line shows Instagram reach and posts made outside the plan', async ({ page }) => {
  await page.route('**/api/social/live*', (route) => route.fulfill({ json: live('m1', null) }));
  await openApp(page);
  await openTab(page, 'Social');
  await expect(page.getByText('Instagram', { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/1 post · 1\.2K reach/i)).toBeVisible();
  await page.getByText('Posted outside your plan (1)').click();
  await expect(page.getByRole('link', { name: 'Shared outside the plan' })).toBeVisible();
});

test('a reconnect state says so instead of stats', async ({ page }) => {
  await page.route('**/api/social/live*', (route) => route.fulfill({ json: { platforms: [{ platform: 'threads', username: 'x', state: 'reconnect', posts: [], matchedPostIds: [], publications: {} }] } }));
  await openApp(page);
  await openTab(page, 'Social');
  await expect(page.getByText('Reconnect Threads in Settings to see stats.')).toBeVisible();
});
