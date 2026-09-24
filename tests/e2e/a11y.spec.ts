import AxeBuilder from '@axe-core/playwright';
import { expect, openApp, openTab, test, type Tab } from './support/fixtures';

type Violation = { id: string; impact?: string | null; help: string; nodes: Array<{ target: unknown }> };
const summarize = (where: string, violations: Violation[]) => violations
  .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
  .map((violation) => `${where}: [${violation.impact}] ${violation.id} — ${violation.help} (${violation.nodes.length}× e.g. ${JSON.stringify(violation.nodes[0]?.target)})`);

test('no serious or critical accessibility violations', async ({ page, browser, baseURL }, testInfo) => {
  const findings: string[] = [];
  const anonymous = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const login = await anonymous.newPage();
  await login.goto('/login');
  findings.push(...summarize('login', (await new AxeBuilder({ page: login }).analyze()).violations as Violation[]));
  await anonymous.close();

  await openApp(page);
  for (const tab of ['Home', 'Finance', 'Health', 'Invest', 'Profile'] as Tab[]) {
    await openTab(page, tab);
    await page.waitForTimeout(800);
    findings.push(...summarize(tab, (await new AxeBuilder({ page }).analyze()).violations as Violation[]));
  }
  for (const section of ['Journal', 'Settings']) {
    await page.getByRole('tab', { name: section }).click();
    await page.waitForTimeout(500);
    findings.push(...summarize(`Profile/${section}`, (await new AxeBuilder({ page }).analyze()).violations as Violation[]));
  }
  await testInfo.attach('a11y.txt', { body: findings.join('\n'), contentType: 'text/plain' });
  console.log(findings.join('\n'));
  expect(findings).toEqual([]);
});
