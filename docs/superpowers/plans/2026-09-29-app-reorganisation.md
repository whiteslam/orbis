# App Reorganisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganise Orbis into five tabs (Today · Money · Health · Journal · Social), one Settings sheet opened from an avatar on every screen, and one global Ask Orbis assistant. Split the 595-line shell and the 1,615-line stylesheet along the way.

**Architecture:** Four stages, and each one leaves the app working.
1. **Code split.** Move the code without changing anything visible.
2. **Settings sheet.** Add it beside the existing Profile tab.
3. **New tab layout.** Switch tabs and make the assistant global. Old links keep working through one pure routing module, `lib/shell/tabs.ts`.
4. **Setup checklist and docs.**

**Tech Stack:** Next.js 16 App Router (client shell in `components/`), React 19, Supabase, Vitest (unit tests under `lib/**/*.test.ts` only), Playwright e2e (`tests/e2e`, run against a production build on :3100 with two temporary users), pnpm.

**Spec:** `docs/superpowers/specs/2026-09-29-app-reorganisation-design.md`

## Global Constraints

- **This is not the Next.js you know.** Read the relevant guide in `node_modules/next/dist/docs/` before using any Next API you have not already seen in this repo (AGENTS.md).
- **Pure logic goes in `lib/` with a test beside it.** Vitest only collects `lib/**/*.test.ts`. A module a test imports must not import `server-only`.
- **Every stage ends green:** `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`. Lint baseline: `components/orbis-app.tsx` has 5 unused-var warnings today, and Task 1 removes them. No new warnings.
- **Server action files do not move.** `app/**/actions.ts` keep their paths; only imports of components change.
- **CSS class names are not renamed.** The CSS split in Task 3 must be byte-identical when concatenated in import order.
- **Old links keep working:**
  - hashes `#home`, `#finance`, `#invest`, `#profile`, `#social/<yyyy-mm>`;
  - `?tab=` values `home`, `finance`, `invest`, `settings`.
- **Settings is a sheet above the bottom nav.** Tapping any tab closes it.
- **The assistant button and panel always render.** Only the mic inside the panel depends on `SARVAM_API_KEY`.
- **No `<nav>` element anywhere except the bottom nav.** e2e `openTab` uses `getByRole('navigation')` in strict mode.
- **Copy style:** sentence case, curly apostrophes (’), arrows written `→`.
- **Commits:** end every commit message with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **An old bookmark, an OAuth return or a PWA shortcut must land somewhere sensible.**
   - `#finance` → Money/Spending, `#invest` → Money/Investments, `#profile` → Today with Settings open on You.
   - `?tab=settings` from the Gmail callback opens Settings on Connections, with the Google notice.
   - Pinned by unit tests in Task 4 and the e2e legacy-link test in Task 7.
2. **Voice is not configured (no `SARVAM_API_KEY`).** Ask Orbis must still be reachable, because Profile → Ask is gone. Pinned by the e2e in Task 8, which runs without the voice skip.
3. **Reloading on Money/Investments stays on Investments; switching back to Spending updates the URL.** The old "leave `#tab/...` alone" rule would freeze `#money/investments`. Pinned in Task 4 (`hashFor`) and Task 7 (e2e reload).
4. **Settings open and a tab is tapped: the sheet closes; Escape closes it too.** Pinned in the Task 6 e2e.
5. **A signed-out or fresh account sees the setup checklist and each row opens the right Settings section; after "Hide" it stays hidden across reloads, and a blocked `localStorage` must not crash.** Pinned in Task 10 (unit test plus e2e).

---

## Stage 1: code split (nothing visible changes)

### Task 1: Split the shell into one file per screen

**Files:**
- Create: `components/shell/loading.tsx`
- Create: `components/today/today-screen.tsx` (from `HomeScreen`, `orbis-app.tsx:84-99,115-223`)
- Create: `components/money/spending-screen.tsx` (from `FinanceScreen`, `orbis-app.tsx:225-320`)
- Create: `components/money/investments-screen.tsx` (replaces `GenericScreen`, `orbis-app.tsx:447-454`)
- Create: `components/health/health-screen.tsx` (from `HealthScreen`, `orbis-app.tsx:322-445`)
- Rename: `components/orbis-app.tsx` → `components/app-shell.tsx`
- Modify: `app/page.tsx` (import on line 2, JSX on line 78)

**Interfaces:**
- Produces:
  - `TabLoading()`, `PartLoading()` from `@/components/shell/loading`
  - `TodayScreen(props)`, which takes HomeScreen's props minus `savedAdviceAt`
  - `SpendingScreen({ summary }: { summary: FinanceSummary })`
  - `InvestmentsScreen({ savedAdvice, notice, clearNotice }: { savedAdvice: SavedPortfolioAdvice | null; notice: string | null; clearNotice: () => void })`
  - `HealthScreen(props)`, with the same props as today
  - `default export AppShell`, with the same props as `OrbisApp`

- [ ] **Step 1: Record the baseline**

Run: `pnpm typecheck && pnpm lint 2>&1 | tail -3 && pnpm test 2>&1 | grep -E "Test Files|Tests "`
Expected: typecheck clean, lint shows `5 problems (0 errors, 5 warnings)` all in `components/orbis-app.tsx`, tests all pass. Write the test count down.

- [ ] **Step 2: Create `components/shell/loading.tsx`**

```tsx
// Placeholders shown while a lazily loaded screen or part of one arrives.

/** A whole tab: carries its own .screen-body so the layout does not jump. */
export function TabLoading() {
  return <div className="screen-body field"><p className="fd-empty">Loading…</p></div>;
}

// For a part of a screen that already sits inside .screen-body: a second one
// would add its own padding and scroll box for the moment it shows.
export function PartLoading() {
  return <p className="fd-empty">Loading…</p>;
}
```

- [ ] **Step 3: Create `components/today/today-screen.tsx`**

Header, then **move verbatim** from `orbis-app.tsx`:
- `fetchJson`, lines 84-94;
- `PORTFOLIO_WAIT_MS`, lines 96-97;
- the `HomeScreen` comment and function, lines 115-223.

Then make these edits:
1. Rename `HomeScreen` to `export function TodayScreen`.
2. Delete `savedAdviceAt` from both the destructured parameters and the props type. It was never read.

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell, UserRound } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { PasskeyPrompt } from '@/components/security/passkey-prompt';
import { FocusNote, QuietList } from '@/components/field/field';
import { RoutineCheck } from '@/components/home/routine-check';
import { WeatherCard } from '@/components/home/weather-card';
import { ImportantMail } from '@/components/home/important-mail';
import type { HealthPlanRecord } from '@/lib/health-docs/types';
import type { FinanceSummary } from '@/lib/finance/types';
import type { StepsSummary } from '@/lib/health/types';
import type { BriefWeather } from '@/lib/home/weather';
import type { BriefPortfolio } from '@/lib/home/portfolio';
import { briefReady, type WeatherPhase } from '@/lib/home/brief-gate';
import { composeQuietRows } from '@/lib/focus/home';
import { composeSocialRow } from '@/lib/focus/social';
import type { FocusTarget } from '@/lib/focus/types';
import { indiaToday } from '@/lib/social/month';
import type { SocialPost } from '@/lib/social/types';
import { composeNote, type HomeNote } from '@/lib/home/note';
import { trainingForToday } from '@/lib/home/training';
import { currentRoutine, missedRoutines, routinesToday } from '@/lib/routines/today';
import type { RoutinesSummary } from '@/lib/routines/types';

// …moved code here…
```

- [ ] **Step 4: Create `components/money/spending-screen.tsx`**

Header, then move verbatim:
- `type FinanceView`, line 225;
- `FinanceScreen`, lines 227-320, renamed to `export function SpendingScreen`.

```tsx
'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { PenLine } from 'lucide-react';
import { CurrencyCard } from '@/components/finance/currency-card';
import { TransactionList } from '@/components/finance/transaction-list';
import { FieldHead, FieldHero, FieldLabel, useScrollTop } from '@/components/field/field';
import { PartLoading } from '@/components/shell/loading';
import { money } from '@/lib/finance/money';
import type { FinanceSummary } from '@/lib/finance/types';

const ManualTransactionForm = dynamic(() => import('@/components/finance/manual-transaction-form').then((m) => m.ManualTransactionForm), { loading: PartLoading });
const SpendingSummary = dynamic(() => import('@/components/finance/spending-summary').then((m) => m.SpendingSummary), { loading: PartLoading });

// …moved code here…
```

- [ ] **Step 5: Create `components/money/investments-screen.tsx`**

```tsx
'use client';

import { InvestDashboard } from '@/components/invest/invest-dashboard';
import type { SavedPortfolioAdvice } from '@/lib/ai/saved';

/** The investments view: the dashboard in its own scroll area. */
export function InvestmentsScreen({ savedAdvice, notice, clearNotice }: { savedAdvice: SavedPortfolioAdvice | null; notice: string | null; clearNotice: () => void }) {
  return (
    <div className="screen-body field">
      <InvestDashboard savedAdvice={savedAdvice} notice={notice} clearNotice={clearNotice} />
    </div>
  );
}
```

- [ ] **Step 6: Create `components/health/health-screen.tsx`**

Header, then move verbatim:
- `stepTrend`, `STEP_TARGET`, `HealthView` and `HEALTH_DOCS_ON_MAIN`, lines 322-338;
- `HealthScreen`, lines 340-445, as `export function HealthScreen`.

```tsx
'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { FieldHead, FieldHero, FieldSubHead, useScrollTop } from '@/components/field/field';
import { PartLoading } from '@/components/shell/loading';
import { adviceFromSaved, savedWhen, splitSummary, type ShownAdvice } from '@/lib/workbook/shown-advice';
import { documentAdded } from '@/lib/health-docs/format';
import { planWeek } from '@/lib/health/plan-week';
import type { LibraryState } from '@/lib/health-docs/repository';
import type { StepsSummary } from '@/lib/health/types';
import type { SavedWorkbookAdvice } from '@/lib/ai/saved';

const StepsCard = dynamic(() => import('@/components/health/steps-card').then((m) => m.StepsCard), { loading: PartLoading });
const PlanBuilder = dynamic(() => import('@/components/health/plan-builder').then((m) => m.PlanBuilder), { loading: PartLoading });
const HealthLibrary = dynamic(() => import('@/components/health/health-library').then((m) => m.HealthLibrary), { loading: PartLoading });
const WorkbookAsk = dynamic(() => import('@/components/health/workbook-advisor').then((m) => m.WorkbookAsk), { loading: PartLoading });
const WorkbookAdviceView = dynamic(() => import('@/components/health/workbook-advisor').then((m) => m.WorkbookAdviceView), { loading: PartLoading });

// …moved code here…
```

- [ ] **Step 7: Turn `orbis-app.tsx` into `app-shell.tsx`**

Run: `git mv components/orbis-app.tsx components/app-shell.tsx`

In `components/app-shell.tsx`:
1. **Delete** everything that moved in Steps 3-6: lines 59-83 (the loading helpers and dynamic imports), 84-99 (fetchJson and constants, but keep `STALE_AFTER_HIDDEN_MS`), 115-454 (the four screens).
2. **Rename** `export default function OrbisApp` → `export default function AppShell`.
3. **Replace the imports** with exactly this block. It drops the unused `Landmark`, `Sparkles`, `Bell`, `PenLine`, `Focus` and `FocusSurface`.

```tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { HeartPulse, Home, Megaphone, TrendingUp, UserRound, WalletCards } from 'lucide-react';
import { OrbisMark } from '@/components/brand/orbis-mark';
import { TabLoading } from '@/components/shell/loading';
import { TodayScreen } from '@/components/today/today-screen';
import { aiAllowed } from '@/lib/ai/consent';
import type { AiPreferences } from '@/lib/ai/preferences';
import type { SavedPortfolioAdvice, SavedWorkbookAdvice } from '@/lib/ai/saved';
import type { FinanceSummary } from '@/lib/finance/types';
import type { LibraryState } from '@/lib/health-docs/repository';
import type { StepsSummary } from '@/lib/health/types';
import type { JournalSummary } from '@/lib/journal/types';
import type { ContextNote } from '@/lib/memory/notes';
import type { NotificationSettings } from '@/lib/notifications/preferences';
import type { FitnessPersonaSummary, HomeLocation, PersonalProfileSummary } from '@/lib/personal/repository';
import type { AppConnections, Integration } from '@/lib/providers/status';
import type { RoutinesSummary } from '@/lib/routines/types';
import type { SocialMonth } from '@/lib/social/repository';
import type { ProfileSection } from '@/components/personal/profile-screen';

// Today is what opens, so it is the only screen in the first download. Every
// other tab loads the first time it is opened.
const SpendingScreen = dynamic(() => import('@/components/money/spending-screen').then((m) => m.SpendingScreen), { loading: TabLoading });
const InvestmentsScreen = dynamic(() => import('@/components/money/investments-screen').then((m) => m.InvestmentsScreen), { loading: TabLoading });
const HealthScreen = dynamic(() => import('@/components/health/health-screen').then((m) => m.HealthScreen), { loading: TabLoading });
const SocialScreen = dynamic(() => import('@/components/social/social-screen').then((m) => m.SocialScreen), { loading: TabLoading });
const ProfileScreen = dynamic(() => import('@/components/personal/profile-screen').then((m) => m.ProfileScreen), { loading: TabLoading });
// The mic shows on every screen but is not needed to draw Today, so it follows it.
const TalkToOrbis = dynamic(() => import('@/components/voice/talk-to-orbis').then((m) => m.TalkToOrbis));
```

4. **Update the `screen` memo:**
   - `<HomeScreen` becomes `<TodayScreen`, and the `savedAdviceAt={…}` line is deleted.
   - `<FinanceScreen summary=…/>` becomes `<SpendingScreen summary={financeSummary} />`.
   - The final `return <GenericScreen … />` becomes:

```tsx
    return <InvestmentsScreen savedAdvice={savedPortfolioAdvice} notice={zerodhaNotice} clearNotice={() => setZerodhaNotice(null)} />;
```

- [ ] **Step 8: Point the page at the new shell**

In `app/page.tsx`, change `import OrbisApp from '@/components/orbis-app';` to `import AppShell from '@/components/app-shell';`, and `<OrbisApp ` to `<AppShell `.

- [ ] **Step 9: Verify nothing changed**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: typecheck clean, **0 lint problems**, same test count as Step 1.

Run: `wc -l components/app-shell.tsx`
Expected: under 250.

Run: `pnpm test:e2e`
Expected: all pass. The suite is unchanged, and that is the proof nothing moved for the user.

- [ ] **Step 10: Commit**

```bash
git add -A components app/page.tsx
git commit -m "Split the app shell into one file per screen

Home, Expense, Health and Invest move out of orbis-app.tsx into their own
files, and the shell becomes app-shell.tsx. No visible change. Removes the
unused imports and the savedAdviceAt prop that nothing read.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 2: Regroup component folders by feature

**Files:**
- Move: `components/home/*` → `components/today/`
- Move: `components/finance/*`, `components/invest/*` → `components/money/`
- Move: `components/personal/{journal,voice-notes,history-panel,context-notes}.tsx` → `components/journal/`
- Move: `components/personal/fitness-persona.tsx` → `components/health/`
- Move: `components/personal/{account-data,ai-consent,app-integrations,integrations,notification-settings,home-brief-setting,routine-settings,profile-editor}.tsx` → `components/settings/`
- Move: `components/personal/ask-orbis.tsx`, `components/voice/talk-to-orbis.tsx` → `components/assistant/`
- Stays: `components/personal/profile-screen.tsx` (deleted in Task 7)
- Create: `scripts/rewrite-imports.mjs` (used once, then deleted in the same commit)

**Interfaces:**
- Consumes: the files from Task 1.
- Produces: the new import paths above. From here on, later tasks use only the new paths.

- [ ] **Step 1: Move the files**

```bash
git mv components/home/* components/today/
mkdir -p components/money components/journal components/settings components/assistant
git mv components/finance/* components/invest/* components/money/
git mv components/personal/journal.tsx components/personal/voice-notes.tsx components/personal/history-panel.tsx components/personal/context-notes.tsx components/journal/
git mv components/personal/fitness-persona.tsx components/health/
git mv components/personal/account-data.tsx components/personal/ai-consent.tsx components/personal/app-integrations.tsx components/personal/integrations.tsx components/personal/notification-settings.tsx components/personal/home-brief-setting.tsx components/personal/routine-settings.tsx components/personal/profile-editor.tsx components/settings/
git mv components/personal/ask-orbis.tsx components/voice/talk-to-orbis.tsx components/assistant/
ls components/home components/finance components/invest components/voice 2>&1 | grep -v "No such" ; ls components/personal
```

Expected: the old folders are empty or gone, and `components/personal` holds only `profile-screen.tsx`.

- [ ] **Step 2: Write the import rewrite script `scripts/rewrite-imports.mjs`**

```js
// One-off: rewrite '@/components/<old>' imports after the folder regroup.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const moves = [
  [/@\/components\/home\//g, '@/components/today/'],
  [/@\/components\/finance\//g, '@/components/money/'],
  [/@\/components\/invest\//g, '@/components/money/'],
  [/@\/components\/voice\/talk-to-orbis/g, '@/components/assistant/talk-to-orbis'],
  [/@\/components\/personal\/ask-orbis/g, '@/components/assistant/ask-orbis'],
  [/@\/components\/personal\/fitness-persona/g, '@/components/health/fitness-persona'],
  [/@\/components\/personal\/(journal|voice-notes|history-panel|context-notes)\b/g, '@/components/journal/$1'],
  [/@\/components\/personal\/(account-data|ai-consent|app-integrations|integrations|notification-settings|home-brief-setting|routine-settings|profile-editor)\b/g, '@/components/settings/$1'],
];

const files = execSync('git ls-files app components lib tests', { encoding: 'utf8' }).split('\n').filter((file) => /\.(ts|tsx)$/.test(file));
let changed = 0;
for (const file of files) {
  const before = readFileSync(file, 'utf8');
  const after = moves.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), before);
  if (after !== before) { writeFileSync(file, after); changed++; }
}
console.log(`rewrote ${changed} files`);
```

- [ ] **Step 3: Run it and prove no old path is left**

Run: `node scripts/rewrite-imports.mjs && git rm -q --cached scripts/rewrite-imports.mjs 2>/dev/null; rm scripts/rewrite-imports.mjs`

Run: `grep -rnE "@/components/(home|finance|invest|voice)/|@/components/personal/(journal|voice-notes|history-panel|context-notes|fitness-persona|account-data|ai-consent|app-integrations|integrations|notification-settings|home-brief-setting|routine-settings|profile-editor|ask-orbis)" app components lib tests`
Expected: no output.

Also confirm there are no relative imports that could have broken: `grep -rn "from '\.\.\?/" components`. Expected: no output. This was true before the move.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`
Expected: all green, same counts as Task 1.

- [ ] **Step 5: Commit**

```bash
git add -A components app lib tests
git commit -m "Group components by feature: today, money, journal, settings, assistant

Moves only; imports rewritten. components/personal keeps profile-screen until
the new layout replaces it.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 3: Split the stylesheet and clear root duplicates

**Files:**
- Create: `app/styles/01-base.css` … `app/styles/10-assistant.css` (from `app/globals.css`)
- Move: `app/atlas-health.css`, `app/atlas-profile.css`, `app/atlas-social.css`, `app/marketing.css` → `app/styles/`
- Delete: `app/globals.css`
- Modify: `app/layout.tsx:3-7`
- Delete: root `AUDIT_REPORT.md`, `audit.json` (identical copies live in `docs/audit/`)
- Move: root `audit-report.html` → `docs/audit/audit-report.html`
- Create: `scripts/split-css.mjs` (used once, deleted in the same commit)

- [ ] **Step 1: Write `scripts/split-css.mjs`**

It splits at each top-level section comment (`/* ─── `), keeps the bytes exactly, and refuses to write if the file no longer has the ten sections it expects.

```js
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const NAMES = ['01-base', '02-home', '03-hero', '04-views', '05-profile', '06-finance', '07-auth', '08-month', '09-boundaries', '10-assistant'];
const source = readFileSync('app/globals.css');
const text = source.toString('latin1'); // byte-preserving round trip
const starts = [];
// The marker is UTF-8; search the latin1 view for its byte sequence.
const needle = Buffer.from('/* ─── ', 'utf8').toString('latin1');
for (let index = text.indexOf(needle); index !== -1; index = text.indexOf(needle, index + 1)) {
  if (index === 0 || text[index - 1] === '\n') starts.push(index);
}
if (starts.length !== NAMES.length || starts[0] !== 0) throw new Error(`expected ${NAMES.length} sections starting at byte 0, found ${starts.length}`);
mkdirSync('app/styles', { recursive: true });
starts.forEach((start, i) => {
  const end = starts[i + 1] ?? text.length;
  writeFileSync(`app/styles/${NAMES[i]}.css`, Buffer.from(text.slice(start, end), 'latin1'));
});
console.log('split into', NAMES.length, 'files');
```

- [ ] **Step 2: Run it and prove the split is lossless**

Run: `node scripts/split-css.mjs && cat app/styles/0*.css app/styles/10-assistant.css | cmp - app/globals.css && echo IDENTICAL`
Expected: `split into 10 files` then `IDENTICAL`.

- [ ] **Step 3: Move the other stylesheets and delete the originals**

```bash
git mv app/atlas-health.css app/atlas-profile.css app/atlas-social.css app/marketing.css app/styles/
git rm -q app/globals.css
rm scripts/split-css.mjs
```

- [ ] **Step 4: Update `app/layout.tsx` lines 3-7 to import in the same order**

```tsx
import './styles/01-base.css';
import './styles/02-home.css';
import './styles/03-hero.css';
import './styles/04-views.css';
import './styles/05-profile.css';
import './styles/06-finance.css';
import './styles/07-auth.css';
import './styles/08-month.css';
import './styles/09-boundaries.css';
import './styles/10-assistant.css';
import './styles/atlas-health.css';
import './styles/atlas-profile.css';
import './styles/atlas-social.css';
import './styles/marketing.css';
```

Run: `grep -rn "globals.css\|atlas-.*\.css\|marketing.css" app components lib tests README.md --include=*.ts --include=*.tsx --include=*.md | grep -v "app/styles/"`
Expected: no output. Fix any stray reference so it points at `app/styles/…`.

- [ ] **Step 5: Clear the root duplicates**

```bash
cmp AUDIT_REPORT.md docs/audit/AUDIT_REPORT.md && cmp audit.json docs/audit/audit.json && git rm -q AUDIT_REPORT.md audit.json
git mv audit-report.html docs/audit/audit-report.html
```

Expected: both `cmp` succeed silently. If either differs, **stop and ask**: do not delete a copy that is not identical.

- [ ] **Step 6: Verify**

Run: `pnpm build 2>&1 | tail -3 && pnpm test:e2e`
Expected: build succeeds, all e2e green. The a11y and layout specs catch any styling regression.

- [ ] **Step 7: Commit**

```bash
git add -A app docs AUDIT_REPORT.md audit.json audit-report.html
git commit -m "Split globals.css into app/styles along its sections

Byte-identical when concatenated in import order; class names unchanged. The
audit files at the root were duplicates of docs/audit.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Stage 2: Settings sheet (beside the existing Profile tab)

### Task 4: Tabs, settings sections and URL routing as a pure module

**Files:**
- Create: `lib/shell/tabs.ts`
- Test: `lib/shell/tabs.test.ts`

**Interfaces:**
- Produces:
  - `type TabId = 'today' | 'money' | 'health' | 'journal' | 'social'`
  - `type MoneyView = 'spending' | 'investments'`
  - `type SettingsSection = 'you' | 'connections' | 'ai' | 'notifications' | 'day' | 'security' | 'data'`
  - `TABS: Array<{ id: TabId; label: string }>`
  - `SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string }>`
  - `type Opening = { tab: TabId; money?: MoneyView; settings?: SettingsSection }`
  - `openingFromUrl(hash: string, tabParam: string | null): Opening | null`
  - `hashFor(tab: TabId, money?: MoneyView): string`

- [ ] **Step 1: Write the failing test `lib/shell/tabs.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { hashFor, openingFromUrl, SETTINGS_SECTIONS, TABS } from '@/lib/shell/tabs';

describe('TABS', () => {
  it('lists the five tabs in order, one name each', () => {
    expect(TABS.map((tab) => tab.id)).toEqual(['today', 'money', 'health', 'journal', 'social']);
    expect(TABS.map((tab) => tab.label)).toEqual(['Today', 'Money', 'Health', 'Journal', 'Social']);
  });
});

describe('SETTINGS_SECTIONS', () => {
  it('lists the seven sections in the order the sheet shows them', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.label)).toEqual(['You', 'Connections', 'AI & privacy', 'Notifications', 'Your day', 'Security', 'Your data']);
  });
});

describe('openingFromUrl', () => {
  it('opens the current hashes', () => {
    expect(openingFromUrl('#money', null)).toEqual({ tab: 'money' });
    expect(openingFromUrl('#money/investments', null)).toEqual({ tab: 'money', money: 'investments' });
    expect(openingFromUrl('#journal', null)).toEqual({ tab: 'journal' });
    expect(openingFromUrl('#social/2026-09', null)).toEqual({ tab: 'social' });
  });

  it('keeps every hash from the six-tab layout working', () => {
    expect(openingFromUrl('#home', null)).toEqual({ tab: 'today' });
    expect(openingFromUrl('#finance', null)).toEqual({ tab: 'money', money: 'spending' });
    expect(openingFromUrl('#invest', null)).toEqual({ tab: 'money', money: 'investments' });
    expect(openingFromUrl('#profile', null)).toEqual({ tab: 'today', settings: 'you' });
  });

  it('lets ?tab= from an OAuth return win over the hash, old values included', () => {
    expect(openingFromUrl('#health', 'settings')).toEqual({ tab: 'today', settings: 'connections' });
    expect(openingFromUrl('', 'home')).toEqual({ tab: 'today' });
    expect(openingFromUrl('', 'today')).toEqual({ tab: 'today' });
    expect(openingFromUrl('', 'finance')).toEqual({ tab: 'money', money: 'spending' });
    expect(openingFromUrl('', 'invest')).toEqual({ tab: 'money', money: 'investments' });
    expect(openingFromUrl('', 'investments')).toEqual({ tab: 'money', money: 'investments' });
  });

  it('ignores anything it does not know', () => {
    expect(openingFromUrl('', null)).toBeNull();
    expect(openingFromUrl('#nope', null)).toBeNull();
    expect(openingFromUrl('#settings-you', null)).toBeNull();
    expect(openingFromUrl('', 'javascript:alert(1)')).toBeNull();
  });
});

describe('hashFor', () => {
  it('writes one hash per tab, and the bare URL for Today', () => {
    expect(hashFor('today')).toBe('');
    expect(hashFor('money')).toBe('#money');
    expect(hashFor('money', 'spending')).toBe('#money');
    expect(hashFor('money', 'investments')).toBe('#money/investments');
    expect(hashFor('health')).toBe('#health');
    expect(hashFor('journal')).toBe('#journal');
    expect(hashFor('social')).toBe('#social');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run lib/shell/tabs.test.ts`
Expected: FAIL, `Failed to resolve import "@/lib/shell/tabs"`.

- [ ] **Step 3: Write `lib/shell/tabs.ts`**

```ts
/**
 * The app's tabs, its settings sections, and how a URL maps onto them. Pure,
 * so the routing rules, including every link from the six-tab layout, are
 * tested rather than remembered.
 */

export type TabId = 'today' | 'money' | 'health' | 'journal' | 'social';
export type MoneyView = 'spending' | 'investments';
export type SettingsSection = 'you' | 'connections' | 'ai' | 'notifications' | 'day' | 'security' | 'data';

export const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'money', label: 'Money' },
  { id: 'health', label: 'Health' },
  { id: 'journal', label: 'Journal' },
  { id: 'social', label: 'Social' },
];

export const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: 'you', label: 'You' },
  { id: 'connections', label: 'Connections' },
  { id: 'ai', label: 'AI & privacy' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'day', label: 'Your day' },
  { id: 'security', label: 'Security' },
  { id: 'data', label: 'Your data' },
];

export type Opening = { tab: TabId; money?: MoneyView; settings?: SettingsSection };

// The part of the hash before any '/'. Old names map to where that screen lives now.
const BY_HASH: Record<string, Opening> = {
  today: { tab: 'today' },
  home: { tab: 'today' },
  money: { tab: 'money' },
  finance: { tab: 'money', money: 'spending' },
  invest: { tab: 'money', money: 'investments' },
  health: { tab: 'health' },
  journal: { tab: 'journal' },
  social: { tab: 'social' },
  profile: { tab: 'today', settings: 'you' },
};

// ?tab= values sent by the OAuth callbacks, old and new.
const BY_PARAM: Record<string, Opening> = {
  today: { tab: 'today' },
  home: { tab: 'today' },
  money: { tab: 'money' },
  finance: { tab: 'money', money: 'spending' },
  invest: { tab: 'money', money: 'investments' },
  investments: { tab: 'money', money: 'investments' },
  settings: { tab: 'today', settings: 'connections' },
};

/** Where a URL asks the app to open, or null for the default. `?tab=` wins over the hash. */
export function openingFromUrl(hash: string, tabParam: string | null): Opening | null {
  if (tabParam) return BY_PARAM[tabParam] ?? null;
  const [name, rest] = hash.replace(/^#/, '').split('/');
  const opening = BY_HASH[name];
  if (!opening) return null;
  if (name === 'money' && rest === 'investments') return { tab: 'money', money: 'investments' };
  return opening;
}

/** The hash the app writes for what is on screen; Today is the bare URL. */
export function hashFor(tab: TabId, money: MoneyView = 'spending'): string {
  if (tab === 'today') return '';
  if (tab === 'money' && money === 'investments') return '#money/investments';
  return `#${tab}`;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm vitest run lib/shell/tabs.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/shell
git commit -m "Add the tab, settings-section and URL routing rules as a tested module

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 5: An avatar that opens Settings, on every screen's header

**Files:**
- Create: `components/shell/settings-context.tsx`
- Modify: `components/field/field.tsx:9-17` (`FieldHead`)
- Modify: `components/today/today-screen.tsx` (header actions; drop `openSettings`, `Bell`, `UserRound`)
- Modify: `components/app-shell.tsx` (provider and sheet state)
- Create: `app/styles/settings.css`, imported last in `app/layout.tsx`

**Interfaces:**
- Consumes: `SettingsSection` from `@/lib/shell/tabs`.
- Produces:
  - `SettingsProvider` (a React context provider), whose value is `{ open: (section?: SettingsSection) => void; initial: string | null }`
  - `useSettings(): { open; initial } | null`
  - `SettingsButton()`: renders `<button aria-label="Settings">`, or `null` outside the provider

- [ ] **Step 1: Create `components/shell/settings-context.tsx`**

```tsx
'use client';

import { createContext, useContext } from 'react';
import { UserRound } from 'lucide-react';
import type { SettingsSection } from '@/lib/shell/tabs';

type SettingsAccess = { open: (section?: SettingsSection) => void; initial: string | null };

const SettingsContext = createContext<SettingsAccess | null>(null);

/** Provided by the app shell; screens reach Settings through it instead of through props. */
export const SettingsProvider = SettingsContext.Provider;

export function useSettings() {
  return useContext(SettingsContext);
}

/** The avatar in every screen's header. It opens Settings; outside the app shell it renders nothing. */
export function SettingsButton() {
  const settings = useSettings();
  if (!settings) return null;
  return (
    <button className="avatar" type="button" aria-label="Settings" title="Settings" onClick={() => settings.open()}>
      {settings.initial || <UserRound size={16} aria-hidden="true" />}
    </button>
  );
}
```

- [ ] **Step 2: Put it in `FieldHead`**

In `components/field/field.tsx`, add `import { SettingsButton } from '@/components/shell/settings-context';` and replace `FieldHead`'s body:

```tsx
export function FieldHead({ title, subtitle }: { title: string; subtitle?: string }) {
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });
  return (
    <header className="fd-head">
      <div className="fd-head-row">
        <p className="fd-date" suppressHydrationWarning>{subtitle ?? today}</p>
        <SettingsButton />
      </div>
      <h1>{title}</h1>
    </header>
  );
}
```

- [ ] **Step 3: Use it on Today**

In `components/today/today-screen.tsx`:
1. Replace the two header buttons (the Bell "Notification settings" button and the avatar "Open your profile" button) with `<SettingsButton />`, keeping `<ThemeToggle />` before it.
2. Remove the `openSettings` prop from the parameters and the type.
3. Remove `Bell`, `UserRound` and `firstName`, which are now unused. Keep `preferredName`, since `composeNote` uses it.
4. Add `import { SettingsButton } from '@/components/shell/settings-context';`.

- [ ] **Step 4: Create `app/styles/settings.css` and import it after `marketing.css` in `app/layout.tsx`**

```css
/* ─── Settings: the header avatar and the sheet it opens ───────────── */
.fd-head-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.settings-sheet { position: absolute; inset: 0 0 82px; z-index: 15; overflow-y: auto; padding: 22px 16px 28px; background: var(--fd-field, var(--sys-page)); color: var(--fd-ink); }
.settings-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.settings-head h1 { margin: 0; font-size: 31px; font-weight: 700; letter-spacing: -.03em; line-height: 1.1; }
.settings-head button { width: 44px; height: 44px; margin-right: -10px; border: 0; border-radius: 50%; background: transparent; color: var(--fd-soft); display: grid; place-items: center; }
.settings-jump { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 6px; }
.settings-jump button { min-height: 32px; padding: 0 12px; border: 1px solid var(--fd-rule); border-radius: var(--r-pill); background: transparent; color: var(--fd-ink); font-size: 12px; }
.settings-sheet .pf-group { scroll-margin-top: 12px; }
.pf-readonly { margin-left: 6px; padding: 1px 7px; border-radius: var(--r-pill); background: var(--sys-tint-green); color: var(--sys-green); font-size: 10.5px; font-weight: 650; white-space: nowrap; }
```

- [ ] **Step 5: Wire the provider in `components/app-shell.tsx`**

Add these imports:

```tsx
import { SettingsProvider } from '@/components/shell/settings-context';
import type { SettingsSection } from '@/lib/shell/tabs';
```

Add this state and value inside `AppShell`, after the existing `useState`s:

```tsx
  // Which Settings section is open, or null. Task 6 renders the sheet.
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  const settingsAccess = useMemo(() => ({
    open: (section: SettingsSection = 'you') => setSettings(section),
    initial: personalProfile.profile?.preferredName?.trim().charAt(0).toLocaleUpperCase() || null,
  }), [personalProfile.profile?.preferredName]);
```

Then:
1. Remove the `openSettings={…}` line from `<TodayScreen`.
2. Wrap the `.phone-screen` children in `<SettingsProvider value={settingsAccess}>…</SettingsProvider>`.
3. Make each nav button's `onClick` into `() => { setTab(id); setSettings(null); }`.

- [ ] **Step 6: Verify, and do not commit yet**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: green.

The avatar opens nothing until Task 6 renders the sheet, so Tasks 5 and 6 land as **one commit** at the end of Task 6. Do not ship an avatar that does nothing.

### Task 6: The Settings sheet: seven sections, one Connections list, Security

**Files:**
- Create: `components/settings/settings-sheet.tsx`
- Create: `components/settings/security-settings.tsx`
- Modify: `components/settings/app-integrations.tsx` (a *Read-only* badge in `AppHead`)
- Modify: `components/personal/profile-screen.tsx` (import `GOOGLE_NOTICE` from the sheet instead of its own copy)
- Modify: `components/app-shell.tsx` (render the sheet)
- Modify: `tests/e2e/support/fixtures.ts` (add `openSettings`, `TABS`)
- Test: `tests/e2e/settings/settings.spec.ts`

**Interfaces:**
- Consumes: `SETTINGS_SECTIONS`, `SettingsSection` (Task 4); `settings`, `setSettings` state (Task 5).
- Produces:
  - `GOOGLE_NOTICE: Record<string, { text: string; success: boolean }>`
  - `type SettingsData = { personalProfile: PersonalProfileSummary; notificationSettings: NotificationSettingsData; aiPreferences: AiPreferences; routines: RoutinesSummary; appConnections: AppConnections; homeLocation: HomeLocation; integrations: Integration[]; stepsSummary: StepsSummary }`
  - `SettingsSheet({ section, onClose, openHealth, googleNotice, clearGoogleNotice, data }: { section: SettingsSection; onClose: () => void; openHealth: () => void; googleNotice: string | null; clearGoogleNotice: () => void; data: SettingsData })`
  - `SecuritySettings()`
  - e2e helpers `openSettings(page)` and `TABS: Tab[]`

- [ ] **Step 1: Add the e2e helpers to `tests/e2e/support/fixtures.ts`**

After `openTab`:

```ts
/** Every tab, in nav order. Specs that visit all tabs use this, so a layout change is one edit. */
export const TABS: Tab[] = ['Home', 'Expense', 'Health', 'Invest', 'Social', 'Profile'];

/** Opens Settings from the avatar in the current screen's header. */
export async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
}
```

- [ ] **Step 2: Write the failing e2e `tests/e2e/settings/settings.spec.ts`**

```ts
import { expect, openApp, openSettings, openTab, test, TABS } from '../support/fixtures';

test('Settings opens from every tab and closes when a tab is tapped or Escape is pressed', async ({ page, consoleErrors }) => {
  await openApp(page);
  const sheet = page.getByRole('dialog', { name: 'Settings' });
  // Profile has its own identity header until the five-tab layout replaces it.
  for (const tab of TABS.filter((name) => name !== 'Profile')) {
    await openTab(page, tab);
    await openSettings(page);
    await openTab(page, tab);
    await expect(sheet).toBeHidden();
  }
  await openSettings(page);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  expect(consoleErrors).toEqual([]);
});

test('Settings has every section, one Connections list, and security controls', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  const sheet = page.getByRole('dialog', { name: 'Settings' });
  for (const name of ['You', 'Connections', 'AI & privacy', 'Notifications', 'Your day', 'Security', 'Your data']) {
    await expect(sheet.getByRole('heading', { name, exact: true })).toHaveCount(1);
  }
  await expect(sheet.getByText('Google', { exact: true })).toHaveCount(1);
  await expect(sheet.getByText('Read-only').first()).toBeVisible();
  await sheet.getByRole('button', { name: 'Security', exact: true }).click();
  await expect(sheet.getByRole('button', { name: 'Lock now' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Change PIN' }).click();
  await expect(sheet.getByLabel(/New \d-digit PIN/)).toBeVisible();
});
```

Run: `pnpm test:e2e tests/e2e/settings`
Expected: FAIL on `openSettings`, because the dialog is never shown.

- [ ] **Step 3: Add the Read-only badge**

In `components/settings/app-integrations.tsx`, replace `AppHead`'s name line:

```tsx
      <div><strong>{name}<span className="pf-readonly">Read-only</span></strong><small>{detail}</small></div>
```

- [ ] **Step 4: Create `components/settings/security-settings.tsx`**

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { lockAppAction, setPinAction } from '@/app/security/actions';
import { PinInput } from '@/components/security/pin-input';
import { safeAction } from '@/lib/client/safe-action';
import { PIN_LENGTH } from '@/lib/security/pin-rules';

/**
 * Lock Orbis now, or change the device PIN. The PIN is required, so there is
 * no "remove"; setPinAction itself refuses unless the app is unlocked.
 */
export function SecuritySettings() {
  const router = useRouter();
  const [changing, setChanging] = useState(false);
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  function lockNow() {
    startTransition(async () => {
      try {
        await lockAppAction();
      } finally {
        // The page re-renders as the lock screen once the unlock is gone.
        router.refresh();
      }
    });
  }

  function savePin() {
    setMessage(null);
    startTransition(async () => {
      const result = await safeAction(setPinAction)(pin, confirm);
      if (!result.success) {
        setMessage({ text: result.message ?? 'Your PIN could not be saved. Try again.', success: false });
        return;
      }
      setChanging(false);
      setPin('');
      setConfirm('');
      setMessage({ text: 'PIN changed.', success: true });
    });
  }

  return (
    <div className="pf-security">
      <div className="fd-source">
        <div><strong>Lock Orbis now</strong><p>Your PIN, password or passkey opens it again.</p></div>
        <button type="button" onClick={lockNow} disabled={isPending}>Lock now</button>
      </div>
      {changing ? (
        <form className="fd-source" onSubmit={(event) => { event.preventDefault(); savePin(); }}>
          <div>
            <label htmlFor="settings-new-pin">New {PIN_LENGTH}-digit PIN</label>
            <PinInput id="settings-new-pin" value={pin} onChange={setPin} disabled={isPending} />
            <label htmlFor="settings-confirm-pin">Type it again</label>
            <PinInput id="settings-confirm-pin" value={confirm} onChange={setConfirm} disabled={isPending} />
          </div>
          <div className="fd-act">
            <button type="submit" disabled={isPending || pin.length !== PIN_LENGTH || confirm.length !== PIN_LENGTH}>Save PIN</button>
            <button type="button" onClick={() => { setChanging(false); setPin(''); setConfirm(''); }} disabled={isPending}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="fd-source">
          <div><strong>Device PIN</strong><p>Opens Orbis on this device without your password.</p></div>
          <button type="button" onClick={() => setChanging(true)}>Change PIN</button>
        </div>
      )}
      {message && <p className={`fd-msg ${message.success ? 'ok' : 'bad'}`} role="status">{message.text}</p>}
    </div>
  );
}
```

- [ ] **Step 5: Create `components/settings/settings-sheet.tsx`**

```tsx
'use client';

import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { AccountData } from '@/components/settings/account-data';
import { AppIntegrations } from '@/components/settings/app-integrations';
import { HomeBriefSetting } from '@/components/settings/home-brief-setting';
import { HomeCityEditor, Integrations } from '@/components/settings/integrations';
import { NotificationSettings } from '@/components/settings/notification-settings';
import { ProfileEditor } from '@/components/settings/profile-editor';
import { RoutineSettings } from '@/components/settings/routine-settings';
import { SecuritySettings } from '@/components/settings/security-settings';
import { SETTINGS_SECTIONS, type SettingsSection } from '@/lib/shell/tabs';
import type { AiPreferences } from '@/lib/ai/preferences';
import type { StepsSummary } from '@/lib/health/types';
import type { NotificationSettings as NotificationSettingsData } from '@/lib/notifications/preferences';
import type { HomeLocation, PersonalProfileSummary } from '@/lib/personal/repository';
import type { AppConnections, Integration } from '@/lib/providers/status';
import type { RoutinesSummary } from '@/lib/routines/types';

export const GOOGLE_NOTICE: Record<string, { text: string; success: boolean }> = {
  connected: { text: 'Google connected.', success: true },
  cancelled: { text: 'Google connection was cancelled.', success: false },
  'setup-error': { text: 'Google sign-in isn’t set up on the server yet.', success: false },
  error: { text: 'Google could not be connected. Try again.', success: false },
};

export type SettingsData = {
  personalProfile: PersonalProfileSummary;
  notificationSettings: NotificationSettingsData;
  aiPreferences: AiPreferences;
  routines: RoutinesSummary;
  appConnections: AppConnections;
  homeLocation: HomeLocation;
  integrations: Integration[];
  stepsSummary: StepsSummary;
};

const LABEL = Object.fromEntries(SETTINGS_SECTIONS.map((section) => [section.id, section.label])) as Record<SettingsSection, string>;

function jumpTo(section: SettingsSection) {
  document.getElementById(`settings-${section}`)?.scrollIntoView({ block: 'start' });
}

function Group({ id, note, children }: { id: SettingsSection; note?: string; children: ReactNode }) {
  return (
    <section className="pf-group" id={`settings-${id}`} aria-labelledby={`settings-${id}-title`}>
      <h2 className="fd-label" id={`settings-${id}-title`}>{LABEL[id]}</h2>
      {note && <p className="fd-note tight">{note}</p>}
      {children}
    </section>
  );
}

/**
 * Everything you configure, in one place, opened from the avatar on any tab.
 * It sits above the bottom nav, so tapping a tab is always a way out.
 */
export function SettingsSheet({ section, onClose, openHealth, googleNotice, clearGoogleNotice, data }: {
  section: SettingsSection;
  onClose: () => void;
  openHealth: () => void;
  googleNotice: string | null;
  clearGoogleNotice: () => void;
  data: SettingsData;
}) {
  useEffect(() => jumpTo(section), [section]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const notice = googleNotice ? GOOGLE_NOTICE[googleNotice] ?? GOOGLE_NOTICE.error : null;
  const profile = data.personalProfile.profile;
  // Gmail and Groww are already in the list above as account connections.
  const dataServices = data.integrations.filter((item) => item.id !== 'groww' && item.id !== 'gmail');

  return (
    <section className="settings-sheet field pf-screen" role="dialog" aria-label="Settings">
      <header className="settings-head">
        <h1>Settings</h1>
        <button type="button" onClick={onClose} aria-label="Close settings"><X size={18} aria-hidden="true" /></button>
      </header>
      {/* Not a <nav>: the bottom nav must stay the only navigation landmark. */}
      <div className="settings-jump" role="group" aria-label="Settings sections">
        {SETTINGS_SECTIONS.map((item) => <button key={item.id} type="button" onClick={() => jumpTo(item.id)}>{item.label}</button>)}
      </div>

      <Group id="you" note="The name Orbis calls you, what you do, and where you are.">
        <ProfileEditor key={profile ? 'profile-saved' : 'profile-empty'} state={data.personalProfile.state} profile={profile} />
        {data.homeLocation.state !== 'setup' && <HomeCityEditor location={data.homeLocation} />}
      </Group>

      <Group id="connections" note="Everything Orbis reads from. Every connection is read-only, and you can disconnect at any time.">
        {notice && (
          <div className={`fd-msg pf-dismiss ${notice.success ? 'ok' : 'bad'}`} role="status">
            <span>{notice.text}</span>
            <button type="button" onClick={clearGoogleNotice} aria-label="Dismiss message"><X size={14} aria-hidden="true" /></button>
          </div>
        )}
        <AppIntegrations connections={data.appConnections} stepsSummary={data.stepsSummary} openHealth={openHealth} />
        <p className="fd-note tight">Services Orbis uses for weather, rates, prices and AI.</p>
        <Integrations items={dataServices} heading={false} />
      </Group>

      <Group id="ai" note="One switch for every AI feature. Nothing is sent to an AI provider until it is on.">
        <HomeBriefSetting preferences={data.aiPreferences} />
      </Group>

      <Group id="notifications">
        <NotificationSettings settings={data.notificationSettings} />
      </Group>

      <Group id="day" note="The times your day already has. Today leads with whatever is due, and records what you say happened to it.">
        <RoutineSettings summary={data.routines} />
      </Group>

      <Group id="security">
        <SecuritySettings />
      </Group>

      <Group id="data">
        <div className="fd-source pf-account">
          <div><strong>This device</strong><p>Sign out of Orbis here. Your data stays in your account.</p></div>
          <SignOutButton variant="text" />
        </div>
        <AccountData />
      </Group>
    </section>
  );
}
```

- [ ] **Step 6: Share the notice text with Profile**

In `components/personal/profile-screen.tsx`, delete its `GOOGLE_NOTICE` constant and add `import { GOOGLE_NOTICE } from '@/components/settings/settings-sheet';`.

- [ ] **Step 7: Render the sheet in `components/app-shell.tsx`**

Add the dynamic import next to the others:

```tsx
const SettingsSheet = dynamic(() => import('@/components/settings/settings-sheet').then((m) => m.SettingsSheet));
```

Inside `.phone-screen`, after `{screen}`:

```tsx
          {settings && (
            <SettingsSheet
              section={settings}
              onClose={() => setSettings(null)}
              openHealth={() => { setSettings(null); setTab('health'); }}
              googleNotice={gmailNotice}
              clearGoogleNotice={() => setGmailNotice(null)}
              data={{ personalProfile, notificationSettings, aiPreferences, routines, appConnections, homeLocation, integrations, stepsSummary }}
            />
          )}
```

- [ ] **Step 8: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`
Expected: all green, including both new settings specs. The existing Profile specs still pass because Profile is untouched.

- [ ] **Step 9: Commit**

```bash
git add -A components app tests
git commit -m "Add the Settings sheet, opened from an avatar on every screen

Seven sections, one Connections list, and Security.

Opens from the avatar on any tab and sits above the bottom nav. Connections
marks every account link read-only; Security adds Lock now and Change PIN.
Profile keeps working until the five-tab layout replaces it.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Stage 3: new tabs and the global assistant

### Task 7: Five tabs: Today · Money · Health · Journal · Social

**Files:**
- Create: `components/money/money-screen.tsx`
- Create: `components/journal/journal-screen.tsx`
- Modify: `components/money/spending-screen.tsx` (title "Money", `switcher` prop)
- Modify: `components/money/invest-dashboard.tsx` (title "Money", `switcher` prop)
- Modify: `components/money/investments-screen.tsx` (pass `switcher`)
- Modify: `components/health/health-screen.tsx` (Coaching style section, "Ask about a file" button label)
- Modify: `components/app-shell.tsx` (tabs, routing, targets)
- Delete: `components/personal/profile-screen.tsx`, `lib/focus/profile.ts` and its test if nothing else imports them (check in Step 7)
- Modify: `app/manifest.ts:17-21`
- Modify: `app/auth/gmail/callback/route.ts:25-26`, `app/auth/gmail/start/route.ts:21,31`, `app/auth/zerodha/callback/route.ts:24`, `app/auth/zerodha/start/route.ts:23,30`
- Modify: every e2e spec that names Expense, Invest or Profile (listed in Step 10)
- Test: `tests/e2e/navigation/legacy-links.spec.ts`

**Interfaces:**
- Consumes: `TABS`, `TabId`, `MoneyView`, `openingFromUrl`, `hashFor` (Task 4); `SettingsSheet`, `SettingsProvider` (Tasks 5-6).
- Produces:
  - `MoneyScreen({ view, onView, summary, savedPortfolioAdvice, brokerNotice, clearBrokerNotice })`
  - `MoneySwitch({ view, onView })`
  - `JournalScreen({ journal, contextNotes })`
  - `HealthScreen` gains a `fitnessPersona: FitnessPersonaSummary` prop
  - e2e `Tab = 'Today' | 'Money' | 'Health' | 'Journal' | 'Social'`

- [ ] **Step 1: Write the failing legacy-link e2e `tests/e2e/navigation/legacy-links.spec.ts`**

```ts
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
```

Run: `pnpm test:e2e tests/e2e/navigation/legacy-links.spec.ts`
Expected: FAIL. There is no "Money" nav button yet.

- [ ] **Step 2: Create `components/money/money-screen.tsx`**

```tsx
'use client';

import dynamic from 'next/dynamic';
import { TabLoading } from '@/components/shell/loading';
import type { SavedPortfolioAdvice } from '@/lib/ai/saved';
import type { FinanceSummary } from '@/lib/finance/types';
import type { MoneyView } from '@/lib/shell/tabs';

const SpendingScreen = dynamic(() => import('@/components/money/spending-screen').then((m) => m.SpendingScreen), { loading: TabLoading });
const InvestmentsScreen = dynamic(() => import('@/components/money/investments-screen').then((m) => m.InvestmentsScreen), { loading: TabLoading });

/** Spending | Investments, drawn under the Money title by whichever view is open. */
export function MoneySwitch({ view, onView }: { view: MoneyView; onView: (view: MoneyView) => void }) {
  return (
    <div className="fd-tabs" role="tablist" aria-label="Money">
      <button type="button" role="tab" aria-selected={view === 'spending'} onClick={() => onView('spending')}>Spending</button>
      <button type="button" role="tab" aria-selected={view === 'investments'} onClick={() => onView('investments')}>Investments</button>
    </div>
  );
}

export function MoneyScreen({ view, onView, summary, savedPortfolioAdvice, brokerNotice, clearBrokerNotice }: {
  view: MoneyView;
  onView: (view: MoneyView) => void;
  summary: FinanceSummary;
  savedPortfolioAdvice: SavedPortfolioAdvice | null;
  brokerNotice: string | null;
  clearBrokerNotice: () => void;
}) {
  const switcher = <MoneySwitch view={view} onView={onView} />;
  return view === 'spending'
    ? <SpendingScreen summary={summary} switcher={switcher} />
    : <InvestmentsScreen savedAdvice={savedPortfolioAdvice} notice={brokerNotice} clearNotice={clearBrokerNotice} switcher={switcher} />;
}
```

- [ ] **Step 3: Thread `switcher` through the two views**

- **`spending-screen.tsx`:**
  - Signature becomes `SpendingScreen({ summary, switcher }: { summary: FinanceSummary; switcher?: ReactNode })`, with `import type { ReactNode } from 'react'`.
  - In both places, `<FieldHead title="Expense" />` becomes `<FieldHead title="Money" />{switcher}`.
- **`investments-screen.tsx`:** accept `switcher?: ReactNode` and pass it: `<InvestDashboard … switcher={switcher} />`.
- **`invest-dashboard.tsx`:**
  - Add `switcher?: ReactNode` to the props.
  - Change `<FieldHead title="Invest" />` (line 104) to `<FieldHead title="Money" />{switcher}`.

- [ ] **Step 4: Create `components/journal/journal-screen.tsx`**

```tsx
'use client';

import { FieldHead, FieldLabel } from '@/components/field/field';
import { ContextNotes } from '@/components/journal/context-notes';
import { Journal } from '@/components/journal/journal';
import type { JournalSummary } from '@/lib/journal/types';
import type { ContextNote } from '@/lib/memory/notes';

/** Today's entry and its history, and the notes you asked Orbis to remember. */
export function JournalScreen({ journal, contextNotes }: { journal: JournalSummary; contextNotes: { ready: boolean; notes: ContextNote[] } }) {
  return (
    <div className="screen-body field pf-screen">
      <FieldHead title="Journal" />
      <Journal journal={journal} />
      <section className="pf-group">
        <FieldLabel>Saved notes</FieldLabel>
        <p className="fd-note tight">Anything you asked Orbis to remember: a constraint, a preference, something you are saving for.</p>
        <ContextNotes ready={contextNotes.ready} notes={contextNotes.notes} />
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Give Health the coaching style**

In `components/health/health-screen.tsx`:
1. Add the imports: `FieldLabel` (added to the field import), `FitnessPersonaEditor` from `@/components/health/fitness-persona`, and the type `FitnessPersonaSummary` from `@/lib/personal/repository`.
2. Add `fitnessPersona: FitnessPersonaSummary` to the props. Keep `hasSavedFitnessPersona`, since WorkbookAsk still uses it.
3. Insert this section immediately before `<div className="hl-ask">`:

```tsx
      <section className="pf-group">
        <FieldLabel>Coaching style</FieldLabel>
        <p className="fd-note tight">Optional: how you want to be coached when you ask for advice on a fitness workbook or plan.</p>
        <FitnessPersonaEditor key={fitnessPersona.persona ? 'persona-saved' : 'persona-empty'} state={fitnessPersona.state} persona={fitnessPersona.persona} />
      </section>
```

4. In the `hl-ask` row, change the button text from `Ask` to `Ask about a file`. This keeps it distinct from the global Ask Orbis.

- [ ] **Step 6: Rewrite the shell's tabs and routing in `components/app-shell.tsx`**

Replace the old tab plumbing (`type Tab`, `TAB_TO_HASH`, `HASH_TO_TAB`, `nav`, `profileSection`, the URL-reading effect, the hash-writing effect and the `screen` memo) with the code below. Also:
- Remove the `ProfileScreen`, `SpendingScreen`, `InvestmentsScreen` dynamics and the `ProfileSection` import.
- Add the dynamics `MoneyScreen` (from `@/components/money/money-screen`, loading `TabLoading`) and `JournalScreen` (from `@/components/journal/journal-screen`, loading `TabLoading`).
- Imports: `import { BookOpen, HeartPulse, Home, Megaphone, WalletCards, type LucideIcon } from 'lucide-react';`, `import { hashFor, openingFromUrl, TABS, type MoneyView, type SettingsSection, type TabId } from '@/lib/shell/tabs';`, `import type { FocusTarget } from '@/lib/focus/types';`. Remove `TrendingUp` and `UserRound`.

```tsx
const ICONS: Record<TabId, LucideIcon> = { today: Home, money: WalletCards, health: HeartPulse, journal: BookOpen, social: Megaphone };

// inside AppShell:
  const [tab, setTab] = useState<TabId>('today');
  const [money, setMoney] = useState<MoneyView>('spending');

  // Today's cards and quiet rows name where they lead in the older vocabulary.
  const openTarget = (target: FocusTarget) => {
    setSettings(null);
    if (target === 'personal') return setSettings('you');
    if (target === 'finance' || target === 'invest') {
      setMoney(target === 'invest' ? 'investments' : 'spending');
      return setTab('money');
    }
    setTab(target);
  };

  // The tab the URL asked for, until it has been applied (see the hash effect below).
  const pendingTab = useRef<TabId | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const opening = openingFromUrl(url.hash, url.searchParams.get('tab'));
    const notice = url.searchParams.get('gmail');
    const brokerNotice = url.searchParams.get('zerodha');
    // One-time read of the URL a link arrived with, not a value the render depends on.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (opening?.money) setMoney(opening.money);
    if (opening?.settings) setSettings(opening.settings);
    if (opening && opening.tab !== 'today') {
      pendingTab.current = opening.tab;
      setTab(opening.tab);
    }
    if (notice) setGmailNotice(notice);
    if (brokerNotice) setZerodhaNotice(brokerNotice);
    /* eslint-enable react-hooks/set-state-in-effect */
    if (url.searchParams.has('tab') || notice || brokerNotice) {
      url.searchParams.delete('tab');
      url.searchParams.delete('gmail');
      url.searchParams.delete('zerodha');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  useEffect(() => {
    // Until the tab read from the URL is applied, this still sees 'today'; writing
    // now would erase the hash (and Social's own month after it, #social/2026-11).
    if (pendingTab.current) {
      if (tab !== pendingTab.current) return;
      pendingTab.current = null;
    }
    // Social keeps its month in the hash itself; leave that alone while it is open.
    if (tab === 'social' && window.location.hash.startsWith('#social/')) return;
    const hash = hashFor(tab, money);
    if (window.location.hash !== hash) window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${hash}`);
  }, [tab, money]);

  const screen = useMemo(() => {
    if (tab === 'today') return (
      <TodayScreen
        financeSummary={financeSummary}
        stepsSummary={stepsSummary}
        documentCount={healthLibrary.documents.length}
        plan={healthLibrary.plans[0] ?? null}
        routines={routines}
        socialPosts={socialMonth.posts}
        preferredName={personalProfile.profile?.preferredName ?? null}
        aiBriefEnabled={aiPreferences.homeBriefEnabled && aiAllowed(aiPreferences)}
        gmailNotice={gmailNotice}
        clearGmailNotice={() => setGmailNotice(null)}
        openTab={openTarget}
      />
    );
    if (tab === 'money') return <MoneyScreen view={money} onView={setMoney} summary={financeSummary} savedPortfolioAdvice={savedPortfolioAdvice} brokerNotice={zerodhaNotice} clearBrokerNotice={() => setZerodhaNotice(null)} />;
    if (tab === 'health') return <HealthScreen stepsSummary={stepsSummary} healthLibrary={healthLibrary} savedContextCount={contextNotes.notes.length} hasSavedFitnessPersona={Boolean(fitnessPersona.persona)} fitnessPersona={fitnessPersona} hasSavedPersonalProfile={Boolean(personalProfile.profile)} savedWorkbookAdvice={savedWorkbookAdvice} />;
    if (tab === 'journal') return <JournalScreen journal={journal} contextNotes={contextNotes} />;
    return <SocialScreen initial={socialMonth} hasProfile={Boolean(personalProfile.profile)} />;
    // openTarget only calls state setters, which are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, money, financeSummary, stepsSummary, healthLibrary, routines, socialMonth, personalProfile, aiPreferences, gmailNotice, savedPortfolioAdvice, zerodhaNotice, contextNotes, fitnessPersona, savedWorkbookAdvice, journal]);
```

The nav becomes:

```tsx
          <nav className="bottom-nav">
            {TABS.map(({ id, label }) => {
              const Icon = ICONS[id];
              return (
                <button key={id} onClick={() => { setTab(id); setSettings(null); }} className={tab === id ? 'active' : ''} aria-label={label}>
                  <Icon size={17} /><span>{label}</span>
                </button>
              );
            })}
          </nav>
```

Also:
- In `TodayScreen`, `<WeatherCard … openPersonal={() => openTab('personal')} />` stays as it is. `openTarget('personal')` now opens Settings → You, where the city editor lives.
- `openHealth` in the sheet stays `() => { setSettings(null); setTab('health'); }`.

- [ ] **Step 7: Delete Profile**

Run: `grep -rn "profile-screen\|lib/focus/profile" app components lib --include=*.ts --include=*.tsx`
Expected: no output. If `lib/focus/profile.ts` has no importers left, `git rm` it and its test too.

Run: `git rm components/personal/profile-screen.tsx && rmdir components/personal 2>/dev/null; true`

- [ ] **Step 8: Point OAuth returns and PWA shortcuts at the new names**

- **`app/auth/gmail/callback/route.ts`:**
  - Line 25 comment: `// Connections started from Settings return there; others go to Today, where the mail is.`
  - Line 26: `const returnTab = … === 'settings' ? 'settings' : 'today';`
- **`app/auth/gmail/start/route.ts`:**
  - Line 21 comment: `// /auth/gmail/start?return=settings brings the user back to Settings → Connections.`
  - Line 31: `'/?tab=today&gmail=setup-error'`
- **`app/auth/zerodha/callback/route.ts:24` and `app/auth/zerodha/start/route.ts:23,30`:** `?tab=invest` → `?tab=investments`.
- **`app/manifest.ts` shortcuts:**

```ts
    shortcuts: [
      { name: 'Money', url: '/#money' },
      { name: 'Health', url: '/#health' },
      { name: 'Journal', url: '/#journal' },
      { name: 'Social', url: '/#social' },
    ],
```

- [ ] **Step 9: Update the e2e fixture**

In `tests/e2e/support/fixtures.ts`:

```ts
export type Tab = 'Today' | 'Money' | 'Health' | 'Journal' | 'Social';
// …
export const TABS: Tab[] = ['Today', 'Money', 'Health', 'Journal', 'Social'];

/** Money opens on Spending; this switches it to Investments. */
export async function openInvestments(page: Page) {
  await openTab(page, 'Money');
  await page.getByRole('tab', { name: 'Investments' }).click();
}
```

- [ ] **Step 10: Update every spec that names the old tabs**

Make each of these edits exactly:

- **`tests/e2e/auth/session.spec.ts`:**
  - `name: 'Expense'` → `name: 'Money'`, all 4 occurrences.
  - Lines 15-16 (Profile → Settings tab) become `await openSettings(page);`, adding `openSettings` to the import.
- **`tests/e2e/finance/manual-expense.spec.ts`:** every `openTab(page, 'Expense')` / `openTab(pageB, 'Expense')` → `'Money'`. The string `'Expense saved.'` is app copy and stays.
- **`tests/e2e/forms/crud.spec.ts`:**
  - Journal test: `openTab(page, 'Profile'); await page.getByRole('tab', { name: 'Journal' }).click();` → `openTab(page, 'Journal');`, twice.
  - Settings test: `openTab(page, 'Profile'); await page.getByRole('tab', { name: 'Settings' }).click();` → `openSettings(page);`, twice.
  - `openTab(page, 'Home')` → `openTab(page, 'Today')`.
- **`tests/e2e/network/offline.spec.ts:10-11`:** → `await openTab(page, 'Journal');`
- **`tests/e2e/security/security.spec.ts:49-51` and `:58-60`:** the nav Profile click plus `tab 'Profile'` click become `await openSettings(page);`, adding the import.
- **`tests/e2e/navigation/navigation.spec.ts`:**
  - `TABS` becomes `[['Money', /#money$/], ['Health', /#health$/], ['Journal', /#journal$/], ['Social', /#social$/]]`.
  - `openTab(page, 'Home')` → `'Today'`.
  - The deep-link test becomes `openApp(page, '/#money/investments')`, expecting `'Money'` active.
  - The keyboard test: `openTab(page, 'Profile'); …getByRole('tab', { name: 'Profile' }).click();` → `await openSettings(page);`.
- **`tests/e2e/responsive/app-shell.spec.ts:18,22`:**
  - The tab loop becomes `['Money', 'Health', 'Journal', 'Social', 'Today'] as const`.
  - `openTab(page, 'Expense')` → `'Money'`.
- **`tests/e2e/responsive/layout.spec.ts:8`:** `const TABS` → import `TABS` from the fixtures and delete the local constant.
- **`tests/e2e/a11y.spec.ts:18-27`:** the tab loop becomes `for (const tab of TABS)` (import `TABS`). Replace the Profile-sections loop with:

```ts
  await openInvestments(page);
  await page.waitForTimeout(800);
  findings.push(...summarize('Money/Investments', (await new AxeBuilder({ page }).analyze()).violations as Violation[]));
  await openSettings(page);
  await page.waitForTimeout(500);
  findings.push(...summarize('Settings', (await new AxeBuilder({ page }).analyze()).violations as Violation[]));
```

- **`tests/e2e/settings/settings.spec.ts`:** `TABS.filter((name) => name !== 'Profile')` → `TABS`.

Then run: `grep -rnE "'(Expense|Invest|Profile|Home)'" tests/e2e`
Expected: no tab-name hits. App copy such as `'Expense saved.'` does not match, because the pattern needs a closing quote straight after the word.

- [ ] **Step 11: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`
Expected: all green, including `legacy-links.spec.ts`.

- [ ] **Step 12: Commit**

```bash
git add -A components app tests lib
git commit -m "Five tabs: Today, Money, Health, Journal, Social

Expense and Invest become Money (Spending | Investments); Journal and saved
notes get their own tab; coaching style moves to Health; Profile is gone and
its settings live in the Settings sheet. Old hashes, ?tab= links and PWA
shortcuts are mapped by lib/shell/tabs.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 8: One assistant: talk or type, on every screen

**Files:**
- Modify: `lib/ask/select.ts` (add `pickSources`)
- Test: `lib/ask/select.test.ts`
- Modify: `app/ask/actions.ts` (use `pickSources`; accept `earlier`)
- Modify: `app/ask/talk-actions.ts` (read `sources`)
- Modify: `components/assistant/talk-to-orbis.tsx` (always render; typed input; source chips)
- Modify: `components/app-shell.tsx:TalkToOrbis` dynamic import path is unchanged (already `@/components/assistant/talk-to-orbis` after Task 2)
- Modify: `app/styles/10-assistant.css` (input and chips)
- Delete: `components/assistant/ask-orbis.tsx` (its only user, Profile, is gone)
- Test: `tests/e2e/voice/talk.spec.ts` → rename to `tests/e2e/assistant/assistant.spec.ts`

**Interfaces:**
- Consumes: `answerFromRecords`, `askOrbisAction`, `talkToOrbisAction`, `talkAvailableAction`, `trimHistory`, `ASK_SOURCES`.
- Produces:
  - `pickSources(value: unknown): AskSource[]`
  - `askOrbisAction(input: { question: string; sources: string[]; earlier?: unknown })`
  - talk form field `sources` (a JSON array)

- [ ] **Step 1: Write the failing unit test**

Append to `lib/ask/select.test.ts`, and add `pickSources` to the import:

```ts
describe('pickSources', () => {
  it('keeps known sources once, in the order given', () => {
    expect(pickSources(['steps', 'journal', 'steps'])).toEqual(['steps', 'journal']);
  });

  it('drops anything unknown or not a string, and non-arrays', () => {
    expect(pickSources(['journal', 'passwords', 7, null])).toEqual(['journal']);
    expect(pickSources('journal')).toEqual([]);
    expect(pickSources(undefined)).toEqual([]);
  });
});
```

Run: `pnpm vitest run lib/ask/select.test.ts`
Expected: FAIL, `pickSources is not a function` / not exported.

- [ ] **Step 2: Implement `pickSources` in `lib/ask/select.ts`, after `ASK_SOURCES`**

```ts
/** The sources a question may read: known ids only, each once. Untrusted input from the browser. */
export function pickSources(value: unknown): AskSource[] {
  if (!Array.isArray(value)) return [];
  const known = new Set<string>(ASK_SOURCES.map((source) => source.id));
  return Array.from(new Set(value.filter((source): source is AskSource => typeof source === 'string' && known.has(source))));
}
```

Run: `pnpm vitest run lib/ask/select.test.ts`
Expected: PASS.

- [ ] **Step 3: Use it in both actions**

**`app/ask/actions.ts`:**
1. Import `pickSources` (and drop `ASK_SOURCES` and `SOURCE_IDS`) and `trimHistory` from `@/lib/voice/talk`.
2. The signature becomes `askOrbisAction(input: { question: string; sources: string[]; earlier?: unknown })`.
3. Replace the `sources` line with `const sources = pickSources(input.sources);`.
4. Make the final call `return answerFromRecords({ userId, question, sources, earlier: trimHistory(input.earlier) });`.

**`app/ask/talk-actions.ts`:** after the history parsing, add this, and pass `sources` instead of `TALK_SOURCES` to `answerFromRecords`:

```ts
  let sources: AskSource[] = TALK_SOURCES;
  if (form.has('sources')) {
    try {
      sources = pickSources(JSON.parse(String(form.get('sources'))));
    } catch {
      sources = [];
    }
    if (!sources.length) return { success: false, message: 'Choose at least one thing Orbis may look at.' };
  }
```

The import becomes `import { pickSources, type AskSource, type Citation } from '@/lib/ask/select';`.

- [ ] **Step 4: Update the e2e first (failing) `tests/e2e/assistant/assistant.spec.ts`**

Run: `git mv tests/e2e/voice/talk.spec.ts tests/e2e/assistant/assistant.spec.ts`, then replace its content:

```ts
import { loadEnv } from '../support/env';
import { expect, openApp, openTab, test } from '../support/fixtures';

const voice = Boolean(loadEnv().SARVAM_API_KEY?.trim());

test('Ask Orbis is on every tab and answers a typed question, voice or not', async ({ page, consoleErrors }) => {
  await openApp(page);
  const button = page.getByRole('button', { name: 'Ask Orbis' });
  await expect(button).toBeVisible();
  await openTab(page, 'Health');
  await expect(button).toBeVisible();

  await button.click();
  const panel = page.getByRole('region', { name: 'Ask Orbis' });
  await expect(panel.getByRole('button', { name: 'Journal', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('button', { name: 'Speak' })).toHaveCount(voice ? 1 : 0);

  // Test users have AI off, so the answer is the consent message: proof the typed path reached the server.
  await panel.getByLabel('Type a question').fill('How much did I spend this week?');
  await panel.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText(/AI features are off|No private AI model/);

  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toBeHidden();
  expect(consoleErrors).toEqual([]);
});
```

Run: `pnpm test:e2e tests/e2e/assistant`
Expected: FAIL. There is no "Ask Orbis" button yet.

- [ ] **Step 5: Change the panel in `components/assistant/talk-to-orbis.tsx`**

1. **Rename state `available` → `voice`.** Stop returning `null` when it is false: delete `if (!available) return null;`.
2. **Imports:**
   - `lucide-react`: add `Sparkles` and `Send`.
   - Add `import { askOrbisAction } from '@/app/ask/actions';` and `import { ASK_SOURCES, type AskSource } from '@/lib/ask/select';`.
   - Change the React import to `import { useEffect, useRef, useState, type FormEvent } from 'react';`.
3. **New state:**

```tsx
  const [sources, setSources] = useState<AskSource[]>(['journal', 'spending', 'routines', 'steps']);
  const [draft, setDraft] = useState('');
```

4. **In `send(audio)`,** after `form.set('history', …)`, add `form.set('sources', JSON.stringify(sources));`. Because `send` runs from the recorder callback, read sources through a ref kept in step the same way as `turnsRef`:
   - add `const sourcesRef = useRef(sources);`;
   - make the chip toggle update both.
5. **Add the typed path:**

```tsx
  async function ask(event: FormEvent) {
    event.preventDefault();
    const question = draft.trim();
    if (question.length < 5 || phase === 'thinking') return;
    silence();
    setMessage(null);
    setPhase('thinking');
    const result = await safeAction(askOrbisAction)({ question, sources: sourcesRef.current, earlier: turnsRef.current.map(({ question: q, answer }) => ({ question: q, answer })) });
    setPhase('idle');
    if (!result.success || !result.answer) {
      setMessage(result.message || 'Orbis couldn’t answer that. Try again.');
      return;
    }
    setDraft('');
    turnsRef.current = [...turnsRef.current, { question, answer: result.answer }];
    setTurns(turnsRef.current);
  }

  function toggle(source: AskSource) {
    const next = sources.includes(source) ? sources.filter((item) => item !== source) : [...sources, source];
    sourcesRef.current = next;
    setSources(next);
  }
```

6. **The JSX changes:**
   - The FAB gets `aria-label="Ask Orbis"`, and its icon is `<Sparkles size={20} />`.
   - The section is `aria-label="Ask Orbis"` and the header text is `Ask Orbis`.
   - The hint text: `Ask about your spending, journal, routines or steps, by typing${voice ? ' or speaking in any Indian language' : ''}. Recordings aren’t kept.` Rendered as `{…}` with a template literal.
   - Insert the chips right after the header:

```tsx
          <div className="fd-chips talk-sources" role="group" aria-label="What Orbis may look at">
            {ASK_SOURCES.map((source) => (
              <button key={source.id} type="button" aria-pressed={sources.includes(source.id)} onClick={() => toggle(source.id)} disabled={phase === 'thinking'}>{source.label}</button>
            ))}
          </div>
```

   - The footer becomes:

```tsx
          <footer className="talk-foot">
            {voice && (
              <button type="button" className={`talk-mic ${phase}`} onClick={onMic} disabled={phase === 'thinking' || !sources.length} aria-label={phase === 'listening' ? 'Done speaking' : 'Speak'}>
                {phase === 'thinking' ? <LoaderCircle className="workbook-spinner" size={24} /> : phase === 'listening' ? <Square size={20} /> : <Mic size={24} />}
              </button>
            )}
            <form className="talk-type" onSubmit={ask}>
              <input aria-label="Type a question" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={300} placeholder={phase === 'listening' ? 'Listening…' : 'Type a question'} disabled={phase === 'thinking' || phase === 'listening'} />
              <button type="submit" aria-label="Ask" disabled={draft.trim().length < 5 || !sources.length || phase === 'thinking'}><Send size={16} /></button>
            </form>
          </footer>
```

   - Remove the old `<span className="talk-status">` (the input placeholder now carries the listening state) and the `status` constant.

- [ ] **Step 6: Styles, appended to `app/styles/10-assistant.css`**

```css
.talk-sources { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0 16px 8px; }
.talk-type { flex: 1; display: flex; align-items: center; gap: 6px; min-width: 0; }
.talk-type input { flex: 1; min-width: 0; height: 44px; padding: 0 14px; border: 1px solid var(--sys-separator); border-radius: var(--r-pill); background: var(--sys-surface-2); color: var(--sys-label); font-size: 15px; }
.talk-type button { width: 44px; height: 44px; flex: none; border: 0; border-radius: 50%; display: grid; place-items: center; background: var(--sys-blue); color: #fff; }
.talk-type button:disabled { opacity: .5; }
```

- [ ] **Step 7: Delete the old Ask Orbis component**

Run: `grep -rn "assistant/ask-orbis" app components lib`
Expected: no output.

Run: `git rm components/assistant/ask-orbis.tsx`

- [ ] **Step 8: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`
Expected: all green, including `assistant.spec.ts`. It runs whether or not the key is set; the mic assertion adapts.

- [ ] **Step 9: Commit**

```bash
git add -A lib app components tests
git commit -m "Make Ask Orbis one assistant: type or talk, on every screen

The panel always shows; the mic appears only when voice is configured. Source
chips apply to both, and typed questions keep the conversation too. Replaces
Profile's Ask section.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 9: Point every user-facing "Profile → …" at its new home

**Files:**
- Modify: `lib/ai/consent.ts:15`
- Modify: `lib/providers/status.ts:64,146,158`
- Modify: `app/delete-account/page.tsx:25`, `app/privacy/page.tsx:73`, `app/support/page.tsx:36`, `app/terms/page.tsx:52`
- Modify: `app/social/actions.ts:314`, `components/social/ai-draft-dialog.tsx:92`
- Modify: `components/money/broker-card.tsx:26` (comment)

- [ ] **Step 1: Find every occurrence**

Run: `grep -rn "Profile →\|Profile >\|Reconnect in Invest\|in Profile" app lib components --include=*.ts --include=*.tsx`
Expected: exactly the lines listed under Files, plus nothing else. If there are more, add them to this task.

- [ ] **Step 2: Replace the copy**

| Where | Old | New |
|---|---|---|
| `lib/ai/consent.ts:15` | `Turn them on in Profile → Settings.` | `Turn them on in Settings → AI & privacy.` |
| `lib/providers/status.ts:64` (comment) | `(Settings → App integrations)` | `(Settings → Connections)` |
| `lib/providers/status.ts:146` | `'Reconnect in Invest'` | `'Reconnect in Settings → Connections'` |
| `lib/providers/status.ts:158` | `'Connect in Profile → Settings'` / `'Reconnect in Profile → Settings'` | `'Connect in Settings → Connections'` / `'Reconnect in Settings → Connections'` |
| four legal/support pages | `<strong>Profile → Settings → Account → Delete account</strong>` (privacy/terms wrap the last word onto the next line; keep that wrap) | `<strong>Settings → Your data → Delete account</strong>` |
| `app/social/actions.ts:314` | `Fill in Profile → About you` | `Fill in Settings → You` |
| `components/social/ai-draft-dialog.tsx:92` | `(fill in Profile → About you first)` | `(fill in Settings → You first)` |
| `components/money/broker-card.tsx:26` (comment) | `(Profile →` | `(Settings → Connections` |

- [ ] **Step 3: Verify**

Run: `grep -rn "Profile →" app lib components`
Expected: no output.

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`
Expected: green. The assistant e2e matches `AI features are off`, which is unchanged.

- [ ] **Step 4: Commit**

```bash
git add -A app lib components
git commit -m "Point every Profile → … instruction at Settings

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Stage 4: setup checklist and docs

### Task 10: A setup checklist on Today

**Files:**
- Create: `lib/focus/setup.ts`
- Test: `lib/focus/setup.test.ts`
- Create: `components/today/setup-checklist.tsx`
- Modify: `components/today/today-screen.tsx` (render it after `<PasskeyPrompt />`; new `setup` prop)
- Modify: `components/app-shell.tsx` (compute `setup`)
- Modify: `app/styles/settings.css` (checklist rows)
- Test: `tests/e2e/today/setup.spec.ts`

**Interfaces:**
- Consumes: `SettingsSection` (Task 4), `useSettings` (Task 5), `aiAllowed` (`lib/ai/consent`).
- Produces:
  - `type SetupStep = { id: 'ai' | 'google' | 'day' | 'name'; label: string; section: SettingsSection }`
  - `setupSteps(input: { aiOn: boolean; googleConnected: boolean; routineCount: number; hasName: boolean }): SetupStep[]`
  - `SetupChecklist({ steps }: { steps: SetupStep[] })`

- [ ] **Step 1: Write the failing test `lib/focus/setup.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { setupSteps } from '@/lib/focus/setup';

const done = { aiOn: true, googleConnected: true, routineCount: 2, hasName: true };

describe('setupSteps', () => {
  it('lists every step for a fresh account, in order, each pointing at its Settings section', () => {
    expect(setupSteps({ aiOn: false, googleConnected: false, routineCount: 0, hasName: false }).map((step) => [step.id, step.section])).toEqual([
      ['name', 'you'],
      ['ai', 'ai'],
      ['google', 'connections'],
      ['day', 'day'],
    ]);
  });

  it('drops what is already done', () => {
    expect(setupSteps({ ...done, aiOn: false }).map((step) => step.id)).toEqual(['ai']);
  });

  it('is empty once everything is set up', () => {
    expect(setupSteps(done)).toEqual([]);
  });
});
```

Run: `pnpm vitest run lib/focus/setup.test.ts`
Expected: FAIL, cannot resolve `@/lib/focus/setup`.

- [ ] **Step 2: Implement `lib/focus/setup.ts`**

```ts
/**
 * The first things worth setting up, for Today's checklist. Pure: each step
 * is shown only while it is undone, and says which Settings section does it.
 */
import type { SettingsSection } from '@/lib/shell/tabs';

export type SetupStep = { id: 'ai' | 'google' | 'day' | 'name'; label: string; section: SettingsSection };

export function setupSteps(input: { aiOn: boolean; googleConnected: boolean; routineCount: number; hasName: boolean }): SetupStep[] {
  const steps: Array<SetupStep & { done: boolean }> = [
    { id: 'name', label: 'Tell Orbis your name', section: 'you', done: input.hasName },
    { id: 'ai', label: 'Turn on AI for the brief and Ask Orbis', section: 'ai', done: input.aiOn },
    { id: 'google', label: 'Connect Google for mail and calendar', section: 'connections', done: input.googleConnected },
    { id: 'day', label: 'Set the times your day already has', section: 'day', done: input.routineCount > 0 },
  ];
  return steps.filter((step) => !step.done).map(({ done: _done, ...step }) => step);
}
```

Run: `pnpm vitest run lib/focus/setup.test.ts`
Expected: PASS.

If lint flags `_done` as unused, replace the last line with `return steps.filter((step) => !step.done).map((step) => ({ id: step.id, label: step.label, section: step.section }));`.

- [ ] **Step 3: Write the failing e2e `tests/e2e/today/setup.spec.ts`**

```ts
import { expect, openApp, test } from '../support/fixtures';

test('the setup checklist opens the right Settings section and stays hidden once hidden', async ({ page }) => {
  await openApp(page);
  const list = page.getByRole('region', { name: 'Set up Orbis' });
  // Test users start with AI off, so that step is always present.
  await list.getByRole('button', { name: /Turn on AI/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Settings' });
  await expect(sheet.getByRole('heading', { name: 'AI & privacy' })).toBeInViewport();
  await sheet.getByRole('button', { name: 'Close settings' }).click();

  await list.getByRole('button', { name: 'Hide' }).click();
  await expect(list).toBeHidden();
  await page.reload();
  await openApp(page);
  await expect(page.getByRole('region', { name: 'Set up Orbis' })).toBeHidden();
});
```

Run: `pnpm test:e2e tests/e2e/today`
Expected: FAIL, because the region is not found.

- [ ] **Step 4: Create `components/today/setup-checklist.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useSettings } from '@/components/shell/settings-context';
import type { SetupStep } from '@/lib/focus/setup';

const HIDDEN_KEY = 'orbis.setupChecklist.hidden';

function readHidden() {
  try {
    return window.localStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** What is left to set up, each row opening the Settings section that does it. Hidden for good on this device with "Hide". */
export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  const settings = useSettings();
  // Starts hidden so the server render and the first client render agree; the
  // saved choice is read after mount.
  const [hidden, setHidden] = useState(true);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setHidden(readHidden()), []);

  if (hidden || !steps.length || !settings) return null;

  function hide() {
    setHidden(true);
    try {
      window.localStorage.setItem(HIDDEN_KEY, '1');
    } catch {
      // Private mode or blocked storage: hidden for this visit only.
    }
  }

  return (
    <section className="fd-quiet setup-list" aria-label="Set up Orbis">
      <h2>Set up Orbis</h2>
      {steps.map((step) => (
        <button key={step.id} className="fd-line" type="button" onClick={() => settings.open(step.section)}>
          <span>{step.label}</span>
          <b className="fd-yes">Open</b>
        </button>
      ))}
      <div className="fd-act"><button type="button" onClick={hide}>Hide</button></div>
    </section>
  );
}
```

- [ ] **Step 5: Render it**

- **`components/today/today-screen.tsx`:**
  - Add `setup: SetupStep[]` to the props (`import type { SetupStep } from '@/lib/focus/setup'`).
  - Import `SetupChecklist`.
  - Render `<SetupChecklist steps={setup} />` directly after `<PasskeyPrompt />`.
- **`components/app-shell.tsx`:**
  - `import { setupSteps } from '@/lib/focus/setup';`
  - Pass this to `TodayScreen`, adding the four inputs to the memo's dependency list via their parent objects (already present, plus `appConnections`):

```tsx
        setup={setupSteps({
          aiOn: aiAllowed(aiPreferences),
          googleConnected: Boolean(appConnections.google) && appConnections.google?.status !== 'reconnect_required',
          routineCount: routines.routines.length,
          hasName: Boolean(personalProfile.profile?.preferredName?.trim()),
        })}
```

- [ ] **Step 6: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`
Expected: all green, including `setup.spec.ts` and the a11y spec.

- [ ] **Step 7: Commit**

```bash
git add -A lib components tests
git commit -m "Add a setup checklist to Today

Lists what a fresh account has not set up yet (name, AI, Google, your day);
each row opens the Settings section that does it. Hide keeps it hidden on this
device.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 11: Bring the README and roadmap up to date

**Files:**
- Modify: `README.md` (the features-by-tab and architecture sections)
- Modify: `BUILD_ROADMAP.md` (§6a status; a line for this reorganisation)

- [ ] **Step 1: Rewrite the README's features-by-tab section to match the app**

Replace the per-tab feature list with this text, keeping the surrounding headings. Before writing, open the app and check each line against what actually ships.

```markdown
- **Today:** setup checklist, the daily brief, routine check-in, weather, important mail, and quiet rows for everything else.
- **Money:** *Spending* (manual entries and Gmail alerts, this month at a glance) and *Investments* (Zerodha and Groww holdings, portfolio charts, optional AI read).
- **Health:** steps from an Apple Health export, plans, documents, advice, "Ask about a file", and your coaching style.
- **Journal:** a daily entry with mood, tags and voice notes, edit history, and saved notes Orbis remembers.
- **Social:** a month-by-month planner for your own posts.
- **Ask Orbis:** the button on every screen. Type or talk (voice in Indian languages when `SARVAM_API_KEY` is set) about your journal, spending, routines and steps.
- **Settings:** from the avatar on any screen. You, Connections (every link read-only), AI & privacy, Notifications, Your day, Security (lock now, change PIN), Your data (export, delete, sign out).
```

In the architecture paragraph, replace `components/orbis-app.tsx` with `components/app-shell.tsx` and mention `lib/shell/tabs.ts` as the one place tabs and links are defined.

- [ ] **Step 2: Update `BUILD_ROADMAP.md`**

- **§6a "Goals and habits":** change the status to `Not started. The goals, habits and habit_checkins tables exist with no UI; build or drop them.` Untick the UI boxes.
- **Add a dated line under the latest phase:** `2026-09-29: reorganised into five tabs, a Settings sheet and a global Ask Orbis (docs/superpowers/specs/2026-09-29-app-reorganisation-design.md).`

- [ ] **Step 3: Verify**

Run: `grep -n "orbis-app\|Profile →\|Expense tab\|Invest tab" README.md BUILD_ROADMAP.md`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add README.md BUILD_ROADMAP.md
git commit -m "Bring the README and roadmap in line with the five-tab layout

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
