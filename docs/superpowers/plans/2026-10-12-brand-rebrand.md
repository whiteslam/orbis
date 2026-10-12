# Orbis Visual Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the whole Orbis app render in the brand system (dark default, DM Sans, teal/blue gradient, gradient-ring logo) with no change to routing, data, auth or behaviour.

**Architecture:** One new stylesheet, `app/styles/brand.css`, loaded last in both layouts, owns the dark and light palettes. It wins over the older iOS/Field/Glass token blocks by order at equal specificity, and those older dark blocks are then deleted. Components keep their class names; screens inherit the new look through tokens. The logo becomes a CSS conic-gradient ring.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` before using an unfamiliar API — AGENTS.md), React 19, TypeScript, plain CSS, `next/font/google`, Playwright (public suite), pnpm, Windows + Git Bash.

**Spec:** [docs/superpowers/specs/2026-10-12-brand-rebrand-design.md](../specs/2026-10-12-brand-rebrand-design.md). Brand source of truth: [docs/design/orbis-brand-prompt.md](../../design/orbis-brand-prompt.md).

## Global Constraints

- Branch `new-design`. Commit per task. Do **not** push unless asked. Commit only the files the task touches: the working tree also holds unrelated uncommitted waitlist work (`app/styles/marketing.css`, `components/marketing/waitlist-screen.tsx`, `components/marketing/waitlist-backdrop.tsx`, `components/ui/`, `next-env.d.ts`, `.playwright-mcp/`, the bank-statement spec). Never `git add -A`.
- Palette, exact: bg `#0E0E10`; surface 1 `#141416`; surface 2 `#1A1A1E`; border `#242428`; teal `#42CCA8`; blue `#5BB4E8`; green `#3DC87A`; red `#F26B6B`; gold `#F0B429`; gradient `linear-gradient(135deg, #5BB4E8, #42CCA8)`.
- Logo: `conic-gradient` ring `#5BB4E8` → `#42CCA8` → `#3DC87A`; inner hole div at 45% of the diameter; never an SVG stroke.
- Font: DM Sans 300/400/500/600 via `next/font/google` (self-hosted at build, no browser request to Google). Display 28–32px/600, heading 18–20px/600, body 14–15px/400, label 11–12px/500 uppercase 0.5px tracking.
- Cards 16px radius, 1px `#242428` border, background surface 1 or 2. Small pills read as 20px radius; `--r-pill` (999px) is visually identical at ≤40px height and stays.
- Bottom nav 60px high, 20px icons, 10px labels, active tab on the teal gradient. Tabs stay Today, Money, Health, Journal, Social.
- Dark is the default for everyone. Light only when `data-theme="light"` (set from `localStorage['orbis-theme']`).
- CSP is nonce-based and `pnpm test:public` enforces a 250 KB gzipped JS budget on `/`; add no client JS beyond what a task names.
- Text/background pairs must keep WCAG AA (4.5:1 body, 3:1 large). Check every new text colour used on `#0E0E10`, `#141416`, `#1A1A1E`.
- Lint: `react-hooks/refs` forbids ref writes during render; `react-hooks/set-state-in-effect` forbids synchronous setState in effects.

## Review Focus

- A signed-in user with a stored `orbis-theme=light` must still get light (no flash of dark): the pre-paint script and `brand.css` selectors must agree.
- A user whose OS is in light mode but who never chose a theme must now get dark.
- Waitlist (`/`), `/login`, `/privacy`, `/terms` must keep the dark look and legible text (they use `.mkt-*`/`.wl-*`/`.auth-*` classes that hard-code colours).
- Signed-in screens cannot be exercised by the public suite (needs Supabase users); hard-coded light-only colours there would show as unreadable text. The colour sweep in Task 7 is the guard, and its grep must come back clean.
- `prefers-reduced-transparency` fallbacks must still resolve to an opaque surface.

---

### Task 1: Brand tokens and dark-by-default

**Files:**
- Create: `app/styles/brand.css`, `tests/e2e/public/brand.spec.ts`
- Modify: `app/layout.tsx`, `app/(orbis)/layout.tsx`, `components/theme-toggle.tsx`, `app/styles/01-base.css` (delete the two dark blocks), `app/styles/glass-dark.css` (delete the dark blocks), `app/styles/glass.css` (font lines 3–4 only change in Task 2)

**Interfaces:**
- Produces CSS custom properties on `:root`, used by every later task: `--brand-bg`, `--brand-s1`, `--brand-s2`, `--brand-border`, `--brand-teal`, `--brand-blue`, `--brand-green`, `--brand-red`, `--brand-gold`, `--brand-gradient`, plus the existing `--sys-*`, `--fd-*`, `--gl-*`, `--series-*`, `--line`, `--card` names re-valued.

- [ ] **Step 1: Read how the layouts import styles**

Run: `sed -n 1,30p "app/(orbis)/layout.tsx"`
Note the last `import './styles/...css'` line; `brand.css` is imported after it. In `app/layout.tsx` it is imported after `./styles/marketing.css`.

- [ ] **Step 2: Write the failing test**

Create `tests/e2e/public/brand.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('dark brand palette is the default, whatever the OS prefers', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'light' });
  const page = await context.newPage();
  await page.goto('/login');
  const read = (n: string) => page.evaluate(([n]) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), [n]);
  expect((await read('--sys-bg')).toLowerCase()).toBe('#0e0e10');
  expect((await read('--sys-surface')).toLowerCase()).toBe('#141416');
  expect((await read('--sys-surface-2')).toLowerCase()).toBe('#1a1a1e');
  expect((await read('--sys-separator')).toLowerCase()).toBe('#242428');
  expect((await read('--brand-teal')).toLowerCase()).toBe('#42cca8');
  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bodyBg).toBe('rgb(14, 14, 16)');
  await context.close();
});

test('a stored light choice still wins', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark' });
  await context.addInitScript(() => localStorage.setItem('orbis-theme', 'light'));
  const page = await context.newPage();
  await page.goto('/login');
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sys-bg').trim().toLowerCase());
  expect(bg).not.toBe('#0e0e10');
  await context.close();
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm test:public -g "dark brand palette"` (it builds and serves on :3100; takes about a minute).
Expected: FAIL — `--sys-bg` is `#f2f2f7` in light OS mode.

- [ ] **Step 4: Create `app/styles/brand.css`**

```css
/* ─── Orbis brand: the one place the palette is decided ───────────────
   Loaded after every other stylesheet. The older iOS / Field / Glass blocks
   still define the structure of the tokens; this file sets their values.
   Dark is the default; light applies only when <html data-theme="light">. */
:root {
  --brand-bg: #0e0e10;
  --brand-s1: #141416;
  --brand-s2: #1a1a1e;
  --brand-border: #242428;
  --brand-teal: #42cca8;
  --brand-blue: #5bb4e8;
  --brand-green: #3dc87a;
  --brand-red: #f26b6b;
  --brand-gold: #f0b429;
  --brand-gradient: linear-gradient(135deg, #5bb4e8, #42cca8);
  --brand-on-accent: #0e0e10; /* ink on teal/blue/gradient: 8.9:1 on teal */
}

:root:not([data-theme="light"]) {
  color-scheme: dark;

  --sys-bg: var(--brand-bg);
  --sys-surface: var(--brand-s1);
  --sys-surface-2: var(--brand-s2);
  --sys-surface-3: #222226;

  --sys-label: #f2f3f5;
  --sys-secondary: #a0a4ab;   /* 6.9:1 on --brand-s1 */
  --sys-tertiary: #7d818a;    /* 4.3:1 — large text and icons only */
  --sys-separator: var(--brand-border);
  --sys-hairline: #34343a;

  --sys-blue: var(--brand-blue);
  --sys-blue-press: #7cc4ee;
  --sys-green: var(--brand-green);
  --sys-red: var(--brand-red);
  --sys-pink: #f26b9a;
  --sys-amber: var(--brand-gold);
  --sys-tint-blue: #112431;
  --sys-tint-green: #11281d;
  --sys-tint-red: #301616;
  --sys-tint-amber: #302508;

  --sys-wash: linear-gradient(135deg, #12202b, #0f1b1b);
  --sys-wash-border: var(--brand-border);
  --sys-page: var(--brand-bg);
  --sys-stage: radial-gradient(circle at top, #1a1a1e 0, #121214 42%, #0e0e10 100%);

  --e1: 0 1px 3px rgba(0,0,0,.5), 0 0 0 .5px rgba(255,255,255,.05);
  --e2: 0 8px 24px rgba(0,0,0,.5);
  --e3: 0 28px 80px rgba(0,0,0,.6);

  --glass-chrome-bg: rgba(20,20,22,.78);
  --glass-sheet-bg: rgba(20,20,22,.86);
  --glass-edge: inset 0 1px 0 rgba(255,255,255,.06);
  --glass-hairline: 1px solid var(--brand-border);

  --gl-ground: var(--brand-bg);
  --gl-fill: rgba(26,26,30,.72);
  --gl-fill-strong: rgba(36,36,40,.94);
  --gl-edge: 1px solid var(--brand-border);
  --gl-shadow: 0 8px 28px rgba(0,0,0,.4);
  --gl-blob-1: #123027;
  --gl-blob-2: #14283a;
  --gl-blob-3: #1b1b2e;
  --gl-dot: rgba(255,255,255,.04);

  --fd-field: var(--brand-bg);
  --fd-surface: var(--brand-s1);
  --fd-ink: #f2f3f5;
  --fd-soft: #a9adb4;         /* 7.6:1 on --brand-s1 */
  --fd-faint: #8a8e96;        /* 5.2:1 on --brand-s1 */
  --fd-rule: rgba(255,255,255,.08);
  --fd-hairline: rgba(255,255,255,.2);
  --fd-accent: var(--brand-teal);
  --fd-lift: 0 18px 40px rgba(0,0,0,.55);
  --fd-lift-slide: 0 12px 26px -12px rgba(0,0,0,.85);
  --fd-deck-far: rgba(255,255,255,.07);
  --fd-deck-near: rgba(255,255,255,.14);
  --fd-btn: var(--brand-teal);
  --fd-btn-ink: var(--brand-on-accent);
  --fd-chip: rgba(255,255,255,.06);
  --fd-card: var(--brand-s1);
  --fd-wash: rgba(66,204,168,.13);
  --fd-ring-track: rgba(255,255,255,.08);
  --fd-alert: var(--brand-red);
  --fd-alert-wash: rgba(242,107,107,.14);
  --fd-veil: rgba(14,14,16,.9);

  --series-1: #5bb4e8;
  --series-2: #f0b429;
  --series-3: #42cca8;
  --series-4: #f26b6b;
  --series-5: #b49bf2;
  --series-6: #3dc87a;
  --series-7: #8e95a3;
}

:root[data-theme="light"] {
  color-scheme: light;

  --sys-bg: #f4f6f8;
  --sys-surface: #ffffff;
  --sys-surface-2: #eef1f4;
  --sys-surface-3: #e3e7ec;
  --sys-label: #14161a;
  --sys-secondary: #565c66;   /* 6.6:1 on white */
  --sys-tertiary: #757b85;
  --sys-separator: #dfe3e8;
  --sys-hairline: #c9ced6;
  --sys-blue: #1b7fb8;
  --sys-blue-press: #166a9a;
  --sys-green: #1c8a4e;
  --sys-red: #cf3f3f;
  --sys-amber: #9a6a00;
  --sys-tint-blue: #e6f3fb;
  --sys-tint-green: #e6f6ee;
  --sys-tint-red: #fdecec;
  --sys-tint-amber: #fff3d9;
  --sys-wash: linear-gradient(135deg, #e8f4fb, #e8f7f2);
  --sys-wash-border: #d5e6ee;
  --sys-page: #f4f6f8;

  --gl-ground: #eef1f3;
  --fd-field: var(--gl-ground);
  --fd-ink: #14161a;
  --fd-soft: #4c525c;
  --fd-faint: #5b616b;
  --fd-accent: #12806a;
  --fd-alert: #b83a3a;
  --fd-btn: #14161a;
  --fd-btn-ink: #ffffff;
  --fd-veil: rgba(238,241,243,.9);

  --series-1: #1b7fb8;
  --series-2: #b57f00;
  --series-3: #12806a;
  --series-4: #cf3f3f;
  --series-5: #7a5bd1;
  --series-6: #1c8a4e;
  --series-7: #5b616b;
}
```

- [ ] **Step 5: Wire it in and remove the superseded dark blocks**

- In `app/layout.tsx` add `import './styles/brand.css';` after the `marketing.css` import. In `app/(orbis)/layout.tsx` add it after the last style import.
- In `app/styles/01-base.css` delete the `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }` block and the `:root[data-theme="dark"] { … }` block (from the comment “Dark values live in one place…” to the line before `* { box-sizing`). Keep the comment's idea in a one-line note pointing to `brand.css`. Change `color-scheme: light dark;` at the top to `color-scheme: dark;`.
- In `app/styles/glass-dark.css` delete both blocks, leaving the file empty except for a one-line comment `/* Dark values live in brand.css. */`. (Keep the file so imports do not break.)
- In `app/layout.tsx` change the `themeColor` array to a single `themeColor: '#0e0e10'`.
- Leave `[data-theme="dark"]` support harmless: add `:root[data-theme="dark"]` is unnecessary because `:not([data-theme="light"])` already matches it.

- [ ] **Step 6: Make the toggle default to dark**

In `components/theme-toggle.tsx`: `currentTheme()` returns `'dark'` when no `data-theme` is set (server and client), deleting the `matchMedia` fallback; delete the second `useEffect` (system-follow). Keep the first.

```ts
function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}
```

The pre-paint script in `app/layout.tsx` stays as is (it only writes a stored choice).

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm typecheck && pnpm lint && pnpm test:public -g "brand"`
Expected: both brand tests PASS; typecheck and lint clean.

- [ ] **Step 8: Commit**

```bash
git add app/styles/brand.css app/layout.tsx "app/(orbis)/layout.tsx" components/theme-toggle.tsx app/styles/01-base.css app/styles/glass-dark.css tests/e2e/public/brand.spec.ts
git commit -m "Add the Orbis brand palette and make dark the default

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: DM Sans

**Files:** Modify `app/layout.tsx`, `app/styles/glass.css:3-4`, `app/styles/brand.css`, `tests/e2e/public/brand.spec.ts`

**Interfaces:** Produces `--font-dm-sans` (next/font variable) and the type tokens `--t-display`, `--t-heading`, `--t-body`, `--t-label`.

- [ ] **Step 1: Failing test** — append to `brand.spec.ts`:

```ts
test('DM Sans is the body font and ships without a request to Google', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => { if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) external.push(r.url()); });
  await page.goto('/login');
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(family).toMatch(/DM Sans/i);
  expect(external).toEqual([]);
});
```

Run: `pnpm test:public -g "DM Sans"` → FAIL (family is Figtree).

- [ ] **Step 2: Implement** — in `app/layout.tsx` replace the Figtree import and constant:

```ts
import { DM_Sans } from 'next/font/google';
const dmSans = DM_Sans({ subsets: ['latin'], weight: ['300', '400', '500', '600'], variable: '--font-dm-sans', display: 'swap' });
```

and `className={dmSans.variable}` on `<html>`. In `glass.css` lines 3–4 replace `var(--font-figtree)` with `var(--font-dm-sans)`. Check no other `figtree` reference remains: `grep -rni figtree app components lib` must return nothing.

- [ ] **Step 3: Type scale** — append to `brand.css`:

```css
:root {
  --t-display: 600 clamp(28px, 6vw, 32px)/1.1 var(--font-text);
  --t-heading: 600 19px/1.25 var(--font-text);
  --t-body: 400 14.5px/1.5 var(--font-text);
}
.fd-head h1, .page-head h1, .mkt-hero h1 { font-weight: 600; letter-spacing: -.02em; }
.fd-hero-value, .today-widget-value { font-weight: 600; }
.eyebrow, .page-head small, .fd-label { font-size: 11px !important; font-weight: 500 !important; letter-spacing: .5px !important; text-transform: uppercase; }
body { font-weight: 400; }
```

(The existing `.fd-head h1 { font-weight: 800 }` in `glass.css:55` is overridden because `brand.css` loads last and the selector is the same.) The waitlist headline keeps its own weight 300 rule in `marketing.css`; add `.wl-hero h1 { font-weight: 300; }` below so the larger `.mkt-hero` rule does not touch it.

- [ ] **Step 4:** Run `pnpm typecheck && pnpm lint && pnpm test:public -g "DM Sans"` → PASS. Spot-check `pnpm test:public -g "landing"` (JS budget) still passes.

- [ ] **Step 5: Commit** `git add app/layout.tsx app/styles/glass.css app/styles/brand.css tests/e2e/public/brand.spec.ts` → "Switch the app to DM Sans".

---

### Task 3: Gradient-ring logo

**Files:** Modify `components/brand/orbis-mark.tsx`, `app/styles/01-base.css:292`, `app/styles/02-home.css:49`, `app/styles/07-auth.css:8`, `app/styles/marketing.css:8,61`, `app/styles/brand.css`, `tests/e2e/public/brand.spec.ts`

**Interfaces:** `OrbisMark({ size?: number; className?: string })` keeps its signature; every caller (`app-shell`, `auth-shell`, `field`, `public-shell`, `waitlist-screen`, `today-screen`) is unchanged.

- [ ] **Step 1: Failing test**

```ts
test('the logo is a conic-gradient ring with a 45% hole, not an image', async ({ page }) => {
  await page.goto('/login');
  const mark = page.locator('.orbis-mark').first();
  await expect(mark).toBeVisible();
  expect(await mark.evaluate((el) => el.tagName)).toBe('SPAN');
  const bg = await mark.evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(bg).toContain('conic-gradient');
  const [outer, hole] = await mark.evaluate((el) => [el.getBoundingClientRect().width, el.firstElementChild!.getBoundingClientRect().width]);
  expect(hole / outer).toBeGreaterThan(0.43);
  expect(hole / outer).toBeLessThan(0.47);
  expect(await page.locator('.orbis-mark svg').count()).toBe(0);
});
```

Run `pnpm test:public -g "logo"` → FAIL (it is an `<img>`).

- [ ] **Step 2: Implement** — `components/brand/orbis-mark.tsx`:

```tsx
// The Orbis mark: a conic-gradient ring with a hole at 45% of its diameter.
// Two nested elements, never an SVG stroke, so it scales and themes from CSS.
export function OrbisMark({ size = 42, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={['orbis-mark', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
    >
      <span className="orbis-mark-hole" />
    </span>
  );
}
```

CSS (`brand.css`):

```css
.orbis-mark { position: relative; display: block; flex: none; border-radius: 50%; background: conic-gradient(from 200deg, #5bb4e8, #42cca8, #3dc87a, #5bb4e8); box-shadow: none; }
.orbis-mark-hole { position: absolute; top: 50%; left: 50%; width: 45%; height: 45%; transform: translate(-50%, -50%); border-radius: 50%; background: var(--sys-bg); }
```

The hole is filled with the page background so it reads as a hole on every screen. In the four per-context rules (`01-base.css:292`, `02-home.css:49`, `07-auth.css:8`, `marketing.css:8` and `:61`) delete the `border-radius` and `box-shadow` declarations (leave the selector if it has other declarations, otherwise delete the rule).

- [ ] **Step 3:** `pnpm typecheck && pnpm lint && pnpm test:public -g "logo"` → PASS. Also confirm `next/image` is still used elsewhere (`brand-mark.tsx`) so no unused-dependency lint noise.

- [ ] **Step 4: Commit** — "Draw the Orbis logo as a gradient ring".

---

### Task 4: Cards, borders and shape

**Files:** Modify `app/styles/brand.css`

- [ ] **Step 1: Failing test** (computed radius on a real in-page card; the login card is the only public one):

```ts
test('cards use the 16px radius and 1px brand border', async ({ page }) => {
  await page.goto('/login');
  const card = page.locator('.auth-card, .auth-form').first();
  const r = await card.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  expect(parseFloat(r)).toBe(16);
});
```

Before writing it, run `grep -n "auth-card\|auth-shell" components/auth/auth-shell.tsx app/styles/07-auth.css | head` and use the real class of the login panel in the locator. Run → FAIL.

- [ ] **Step 2: Implement** — in `brand.css` set the radius scale so existing rules follow, and make the card border explicit:

```css
:root {
  --r-lg: 16px;
  --r-xl: 16px;
}
.stack-card, .chart-card, .empty-state, .sync-card, .app-card, .currency-card, .integrations, .groww-card,
.apple-card, .invest-ai, .journal-today, .journal-item, .manual-entry, .workbook-advisor, .passkey-prompt {
  border: 1px solid var(--brand-border);
  border-radius: 16px;
}
:root:not([data-theme="light"]) .stack-card, :root:not([data-theme="light"]) .chart-card,
:root:not([data-theme="light"]) .app-card, :root:not([data-theme="light"]) .apple-card { background: var(--brand-s1); }
```

Add the login panel selector found in Step 1 to the list. Phone frame: `.phone` keeps `min(410px,94vw)`; add `border-radius: 40px` to `.phone` and `.phone-screen` only inside the desktop media query (`min-width: 721px`), border `1.5px solid var(--brand-border)`, background `#0a0a0c`, and drop its metal gradient: `.phone { background: #0a0a0c; box-shadow: var(--e3); }`.

- [ ] **Step 3:** `pnpm lint && pnpm test:public -g "cards"` → PASS. Commit "Round and border cards to the brand spec".

---

### Task 5: Bottom navigation

**Files:** Modify `components/app-shell.tsx:234` (icon size 17 → 20), `app/styles/brand.css`, `app/styles/01-base.css` (`--nav-h: 62px` → `60px`)

- [ ] **Step 1:** In `app-shell.tsx` change `<Icon size={17} />` to `<Icon size={20} />`. In `01-base.css` change `--nav-h: 62px;` to `--nav-h: 60px;`.
- [ ] **Step 2:** `brand.css`:

```css
.bottom-nav button span { font-size: 10px; font-weight: 500; letter-spacing: 0; }
.bottom-nav button.active { background: var(--brand-gradient); color: var(--brand-on-accent); box-shadow: 0 4px 14px rgba(66,204,168,.28); font-weight: 600; }
.bottom-nav button.active svg { stroke: var(--brand-on-accent); }
.talk-fab { background: var(--brand-gradient); color: var(--brand-on-accent); border: 0; }
```

- [ ] **Step 3: Verify** — nav is only visible when signed in, so verify by reading rather than the public suite: `grep -n "bottom-nav" app/styles/*.css` and confirm no later rule re-sets the active background (the `glass.css:52` rule has equal specificity and loads earlier, so `brand.css` wins). `pnpm typecheck && pnpm lint`.
- [ ] **Step 4:** If a signed-in session is available (`pnpm test:e2e -g "navigation"` with Supabase env), run it; otherwise state in the final report that the nav was verified by CSS inspection only. Commit "Restyle the bottom nav".

---

### Task 6: Buttons, pills and AI bubbles

**Files:** Modify `app/styles/brand.css`; read `components/assistant/talk-to-orbis.tsx` and `app/styles/10-assistant.css`

- [ ] **Step 1:** Run `grep -n "className" components/assistant/talk-to-orbis.tsx | head -30` to find the user/assistant turn classes (`.talk-turn` variants).
- [ ] **Step 2:** `brand.css` — primary buttons take the gradient, ghost/secondary stay quiet, status pills get brand fills:

```css
.fd-button:not(.ghost), .fd-act button:not(.ghost), .finance-button:not(.secondary) { background: var(--brand-gradient); color: var(--brand-on-accent); font-weight: 600; }
.fd-chips button[aria-pressed="true"] { background: var(--brand-teal); color: var(--brand-on-accent); }
.pill, .badge, .fd-status { border-radius: 20px; padding: 3px 10px; font-size: 11px; font-weight: 500; }
.pill.teal { background: rgba(66,204,168,.16); color: var(--brand-teal); }
.pill.blue { background: rgba(91,180,232,.16); color: var(--brand-blue); }
.pill.red  { background: rgba(242,107,107,.16); color: var(--brand-red); }
.pill.gold { background: rgba(240,180,41,.16); color: var(--brand-gold); }
```

Add, using the class names from Step 1: the user's chat bubble `background: var(--brand-gradient); color: var(--brand-on-accent); align-self: flex-end; border-radius: 16px 16px 4px 16px;` and the assistant bubble `background: var(--brand-s2); border: 1px solid var(--brand-border); border-radius: 16px 16px 16px 4px;`. If the existing markup has no user/assistant distinction, stop and report instead of changing the component.
- [ ] **Step 3:** `pnpm lint && pnpm test:public` (full) → all pass. Commit "Apply the brand gradient to buttons and chat bubbles".

---

### Task 7: Hard-coded colour sweep

**Files:** Modify `app/styles/01-base.css`, `atlas-social.css`, `glass.css`, `marketing.css`, `06-finance.css`, `10-assistant.css`, `atlas-profile.css`, `headsups.css`, plus any `components/**/*.tsx` with inline colours

- [ ] **Step 1: Inventory.** Run
`grep -nE "#[0-9a-fA-F]{3,8}\b|rgba?\(" app/styles/*.css | grep -v "brand.css" | grep -v "^app/styles/01-base.css:[0-9]*:  --" > scratch/colors.txt`
(write to the scratchpad directory, not the repo), and
`grep -rnE "#[0-9a-fA-F]{6}\b|rgba?\(" components lib --include=*.tsx --include=*.ts | grep -v "brand-mark\|\.test\." > scratch/inline.txt`.
- [ ] **Step 2: Map each hit by rule**, editing in place:
  - white or near-white background (`#fff`, `#f…`) → `var(--sys-surface)`; light grey surface → `var(--sys-surface-2)`;
  - dark text (`#1…`, `#2…`, `#000`) → `var(--sys-label)` (or `var(--fd-ink)` inside `.field`);
  - mid-grey text → `var(--sys-secondary)` / `var(--fd-soft)`;
  - hairlines (`rgba(60,60,67,…)`, `rgba(0,0,0,.0x)` borders) → `var(--sys-separator)`;
  - green/blue/red/amber accents → `var(--sys-green|blue|red|amber)`;
  - shadows with black alpha are fine and stay;
  - colours that are decorative gradients inside illustrations may stay if they read on `#0E0E10`; list them in the commit body.
  - In TSX, inline chart/series colours must read from `--series-N` via `getComputedStyle` or CSS variables (`var(--series-1)` in `style`/`fill`), not literals.
- [ ] **Step 3: Verify clean.** Re-run the first grep: every remaining hit must be a shadow/alpha-black, a documented decorative gradient, or a brand colour. The `.mkt-*`/`.wl-*`/`.auth-*` public surfaces must still pass `pnpm test:public`.
- [ ] **Step 4: Waitlist hole colours.** Confirm `components/marketing/waitlist-backdrop.tsx` hot/mid/cool colours: hot `#E4FCFF`, mid `#5bb4e8`, cool `#42cca8`-leaning-indigo `#3a5fd0`; update the three props to the brand blue/teal so the disk matches the logo, and re-run the waitlist visually.
- [ ] **Step 5:** `pnpm typecheck && pnpm lint && pnpm test:public`. Commit by explicit file list: "Move hard-coded colours onto the brand tokens".

---

### Task 8: Icons and share image

**Files:** Create `scripts/render-brand-icons.mjs`; modify `public/icons/*`, `app/icon.png`, `app/apple-icon.png`, `public/apple-touch-icon.png`, `public/brand/orbis-mark.png`, `app/opengraph-image.tsx`

- [ ] **Step 1:** Write `scripts/render-brand-icons.mjs` using the Playwright already in devDependencies: for each target `{ file, size, maskable }` render an HTML page — `#0E0E10` rounded-square background (full-bleed square when `maskable`, with the ring at 60% of the canvas for the safe zone; otherwise 22% corner radius and ring at 62%), a `div` ring with `background: conic-gradient(from 200deg, #5bb4e8, #42cca8, #3dc87a, #5bb4e8)` and a centred hole div `45%` wide filled `#0E0E10` — and `page.screenshot({ path, omitBackground: false })` at the exact pixel size. Targets: `public/icons/icon-192.png` 192, `icon-512.png` 512, `icon-maskable-192.png` 192 maskable, `icon-maskable-512.png` 512 maskable, `public/apple-touch-icon.png` 180, `app/apple-icon.png` 180, `app/icon.png` 512, `public/brand/orbis-mark.png` 512.
- [ ] **Step 2:** Run `node scripts/render-brand-icons.mjs`; open two outputs with the Read tool to confirm they show the ring. Check sizes: `file public/icons/*.png`.
- [ ] **Step 3:** `app/opengraph-image.tsx`: replace the green gradient background with `#0e0e10`, the badge square with a conic-gradient ring + hole (nested divs; `@vercel/og` supports `conic-gradient`—if it does not render, use `linear-gradient(135deg, #5BB4E8, #42CCA8)` for the ring and report it), and text colour `#f2f3f5`. Start the dev server and fetch `/opengraph-image` to confirm a 1200×630 PNG returns 200.
- [ ] **Step 4:** `pnpm test:public -g "pwa"` (manifest/icon checks) → PASS. Commit icons + script + OG: "Regenerate app icons and share image from the ring".
- [ ] **Fallback:** if Playwright cannot launch a browser, skip Steps 1–2, leave icons unchanged, and list the sources in the final report.

---

### Task 9: Whole-branch verification

- [ ] **Step 1:** `pnpm typecheck && pnpm lint && pnpm test && pnpm test:public` — all must pass; report exact counts.
- [ ] **Step 2: Visual check** with Playwright MCP, a fresh `isMobile: true` context at 390×844 and a desktop 1440×900: `/` (waitlist), `/login`, `/privacy`, each in default (dark) and with `localStorage['orbis-theme']='light'`. Confirm: dark `#0E0E10` ground, DM Sans, ring logo with a visible hole, no console errors, no horizontal scroll, text legible.
- [ ] **Step 3: Contrast** — compute ratios for `--sys-secondary`, `--sys-tertiary`, `--fd-soft`, `--fd-faint`, `--brand-on-accent` on teal/blue, and the light-theme equivalents, with a short node script (relative-luminance formula); fix any pair under 4.5:1 for body text.
- [ ] **Step 4:** If a signed-in e2e session is available run `pnpm test:e2e`; otherwise say in the report that signed-in screens were verified by token inheritance and the Task 7 grep only.
- [ ] **Step 5:** Request a review of the full branch diff (`git diff main...new-design`) and fix findings. Do not push; ask the user.
