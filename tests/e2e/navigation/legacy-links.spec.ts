import { expect, openApp, test } from '../support/fixtures';

const active = (page: import('@playwright/test').Page, name: string) =>
  expect(page.getByRole('navigation').getByRole('button', { name, exact: true })).toHaveClass(/active/);

test('links from the six-tab layout still land in the right place', async ({ page }) => {
  await openApp(page, '/#finance');
  await active(page, 'Money');
  await expect(page.getByRole('tab', { name: 'Spending' })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/#money$/);

  await openApp(page, '/#invest');
  await active(page, 'Money');
  await expect(page.getByRole('tab', { name: 'Investments' })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/#money\/investments$/);

  await openApp(page, '/#profile');
  await active(page, 'Today');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();

  await openApp(page, '/?tab=settings&gmail=cancelled');
  await expect(page.getByRole('dialog', { name: 'Settings' }).getByText('Google connection was cancelled.')).toBeVisible();
  await expect(page).not.toHaveURL(/tab=|gmail=/);
});

test('Money remembers Investments across a reload and writes Spending back', async ({ page }) => {
  await openApp(page, '/#money');
  await page.getByRole('tab', { name: 'Investments' }).click();
  await expect(page).toHaveURL(/#money\/investments$/);
  await page.reload();
  await openApp(page, page.url().replace(/^https?:\/\/[^/]+/, ''));
  await expect(page.getByRole('tab', { name: 'Investments' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Spending' }).click();
  await expect(page).toHaveURL(/#money$/);
});
