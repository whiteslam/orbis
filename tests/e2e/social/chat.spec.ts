import { expect, openApp, openTab, test } from '../support/fixtures';

// No draft is sent here: that spends a real AI request. These check the box is wired before anything is asked.
test('the Social chat box picks a platform and format, and the month dialog is still reachable', async ({ page, consoleErrors }) => {
  await openApp(page);
  await openTab(page, 'Social');

  const chat = page.getByRole('region', { name: 'Draft a post with AI' });
  await expect(chat.getByText('What would you like to post?')).toBeVisible();
  await expect(chat.getByRole('button', { name: 'Draft it' })).toBeDisabled();

  await chat.getByRole('button', { name: 'YouTube short' }).click();
  await expect(chat.getByLabel('Platform')).toHaveValue('youtube');
  await expect(chat.getByLabel('Format')).toHaveValue('reel');
  await expect(chat.getByRole('button', { name: 'YouTube short' })).toHaveAttribute('aria-pressed', 'true');

  await chat.getByLabel('What the post is about').fill('A behind-the-scenes look at the new menu');
  await expect(chat.getByRole('button', { name: 'Draft it' })).toBeEnabled();

  await page.getByRole('button', { name: /Plan the month/ }).click();
  await expect(page.getByRole('heading', { name: 'Draft with AI' })).toBeVisible();

  expect(consoleErrors).toEqual([]);
});
