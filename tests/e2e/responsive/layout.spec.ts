import { expect, openApp, openTab, test, type Tab } from '../support/fixtures';

const VIEWPORTS = [
  { width: 320, height: 568 }, { width: 360, height: 640 }, { width: 375, height: 667 }, { width: 390, height: 844 },
  { width: 393, height: 852 }, { width: 412, height: 915 }, { width: 430, height: 932 }, { width: 844, height: 390 },
  { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 },
];
const TABS: Tab[] = ['Home', 'Finance', 'Health', 'Invest', 'Profile'];

type Finding = { viewport: string; tab: string; kind: string; detail: string };

// Checks every tab at phone, landscape, tablet and desktop sizes for layout problems.
test('no horizontal overflow, input zoom, or console errors on any tab', async ({ browser, userA, consoleErrors }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const findings: Finding[] = [];

  for (const viewport of VIEWPORTS) {
    // Phones and landscape phones get real touch emulation (coarse pointer, mobile viewport).
    const mobile = Math.min(viewport.width, viewport.height) < 700;
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, storageState: userA.storageState });
    const page = await context.newPage();
    page.on('pageerror', (error) => consoleErrors.push(`pageerror @${viewport.width}: ${error.message}`));
    page.on('console', (message) => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) consoleErrors.push(`@${viewport.width}: ${message.text()}`); });
    page.on('response', (response) => { if (response.status() === 404 || response.status() >= 500) consoleErrors.push(`HTTP ${response.status()} ${response.url()}`); });
    await openApp(page);
    const label = `${viewport.width}x${viewport.height}${mobile ? ' touch' : ''}`;
    for (const tab of TABS) {
      await openTab(page, tab);
      await page.waitForTimeout(700);
      const report = await page.evaluate((mobile) => {
        const width = window.innerWidth;
        const problems: Array<{ kind: string; detail: string }> = [];
        if (document.documentElement.scrollWidth > width + 1) problems.push({ kind: 'page-overflow', detail: `scrollWidth ${document.documentElement.scrollWidth} > ${width}` });
        // Elements whose box pokes past the viewport edge (visible ones only).
        const offenders = new Set<string>();
        for (const element of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
          const rect = element.getBoundingClientRect();
          if (!rect.width || !rect.height) continue;
          const style = getComputedStyle(element);
          if (style.visibility === 'hidden' || style.position === 'fixed' && rect.right <= width + 1) continue;
          if (rect.right > width + 2 || rect.left < -2) {
            let clipped = false;
            for (let parent = element.parentElement; parent; parent = parent.parentElement) {
              const overflow = getComputedStyle(parent).overflowX;
              if (overflow !== 'visible') { const box = parent.getBoundingClientRect(); if (box.right <= width + 2 && box.left >= -2) { clipped = true; break; } }
            }
            if (!clipped) offenders.add(`${element.tagName.toLowerCase()}.${String(element.className).split(' ').slice(0, 2).join('.')}`);
          }
        }
        if (offenders.size) problems.push({ kind: 'element-overflow', detail: Array.from(offenders).slice(0, 6).join(', ') });
        if (mobile) {
          const small = Array.from(document.querySelectorAll<HTMLElement>('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]), textarea, select'))
            .filter((input) => input.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(input).fontSize) < 16)
            .map((input) => `${input.tagName.toLowerCase()}#${input.id || input.getAttribute('name') || input.getAttribute('aria-label') || '?'}(${getComputedStyle(input).fontSize})`);
          if (small.length) problems.push({ kind: 'input-zoom', detail: Array.from(new Set(small)).slice(0, 8).join(', ') });
          const tiny = Array.from(document.querySelectorAll<HTMLElement>('button, a[href], [role=tab], input[type=checkbox]'))
            .filter((element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && (rect.height < 32 || rect.width < 32); })
            .filter((element) => { const after = getComputedStyle(element, '::after'); return !(after.content !== 'none' && after.position === 'absolute'); })
            .map((element) => (element.getAttribute('aria-label') || element.textContent || element.tagName).trim().slice(0, 24));
          if (tiny.length) problems.push({ kind: 'small-touch-target', detail: `${tiny.length}: ${Array.from(new Set(tiny)).slice(0, 8).join(' | ')}` });
        }
        return problems;
      }, mobile);
      for (const problem of report) findings.push({ viewport: label, tab, ...problem });
      if (viewport.width === 390 || viewport.width === 1920 || viewport.width === 320 || viewport.width === 844) {
        const shot = await page.screenshot({ fullPage: false, path: testInfo.outputPath(`${viewport.width}x${viewport.height}-${tab}.png`) });
        await testInfo.attach(`${label}-${tab}.png`, { body: shot, contentType: 'image/png' });
      }
    }
    await context.close();
  }

  await testInfo.attach('layout-findings.json', { body: JSON.stringify(findings, null, 2), contentType: 'application/json' });
  console.log(JSON.stringify(findings, null, 1));
  expect.soft(findings.filter((finding) => finding.kind === 'page-overflow' || finding.kind === 'element-overflow')).toEqual([]);
  expect.soft(findings.filter((finding) => finding.kind === 'input-zoom')).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
