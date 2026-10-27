# Orbis on a laptop: desktop web layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a wide screen `/active` becomes a full-window web app (left pill rail, top header with a Ctrl/⌘+K palette, multi-column tabs, Ask docked right, Settings as a large dialog), while the phone layout below the breakpoint stays exactly as it is.

**Architecture:** One `AppShell`, one tree. Desktop is a CSS layer (`app/styles/desktop.css`, imported last) behind one media query. The only new markup is a rail and a header that are always rendered and hidden with `display: none` below the breakpoint, plus `data-tab` / `data-money` on `.stage` so the sheet can lay each tab out. Screens keep their DOM: no wrappers (wrappers would change the phone's `.screen-body > *` rise-in stagger in `motion.css`); desktop columns come from CSS grid placement by class.

**Tech Stack:** Next.js 16 (App Router, client components), React 19, plain CSS, lucide-react, Vitest (pure logic in `lib/**`), Playwright (e2e and screenshots).

**Spec:** `docs/superpowers/specs/2026-10-27-web-desktop-design.md`

## Resume here (2026-10-27, end of first session)

**Switch:** everything desktop is off unless the build has `NEXT_PUBLIC_DESKTOP_LAYOUT=1` (`lib/shell/desktop.ts` `DESKTOP_LAYOUT`; every rule in `app/styles/desktop.css` is scoped under `.stage[data-desktop]`, which `components/app-shell.tsx` sets only then). With it off, screenshots of every tab at 390×844 and 1440×900 match the pre-change build pixel for pixel (only seeded data and the brief's clock differ). Turn it on locally with `NEXT_PUBLIC_DESKTOP_LAYOUT=1 pnpm dev`. Remove the switch (and its `.env.example` entry) when Task 10 is done.

**Done:** Tasks 1–4 (logic + tests, shared palette, frame/rail/header/palette/Ask docked, Settings dialog). Tasks 5–8 have a first pass (Today grid, Money/Health/Journal two balanced columns, Social full-width planner) that looks right in screenshots; they still need the polish listed below.

**Next task:** Task 10 (the e2e fixture change, `desktop.spec.ts`, final screenshots). Task 9 is done.

**Known rough edges (switch on):**
- Settings dialog: the "Settings" heading shows the browser's focus box when it opens (it is focused programmatically, as on the phone); give `.settings-head h1:focus` no outline on desktop. The chosen section's card sits in a wide right column; consider `justify-self: start` and a narrower first column.
- Today with no heads-ups is two columns with nothing on the right; with heads-ups it is three. Widgets were squares on a phone; on desktop they are `min-height: 196px`.
- Social's subtitle row is kept on desktop (others drop their date row); the empty state's insights span the full width.
- The 1440 shots are full-page; the fixed wallpaper only paints the first viewport in a full-page capture (a screenshot artefact, not a layout bug).
- `tests/e2e` still assumes the bottom nav at 1440 in some specs (`responsive/*`, `openTab('Career')`); with the switch on they need Task 10's fixture change. With it off nothing changes.
- Not done: the e2e `desktop.spec.ts` and a keyboard pass on the palette/rail/heads-up popover in a real browser.

**Screenshot harness (not committed, it lived in the ignored `.superpowers/shots/`):** a Playwright config with `globalSetup`/`globalTeardown` pointing at `tests/e2e/support/global-setup.ts`/`global-teardown.ts` (needs `.env.local`), `use.baseURL` = the server (`pnpm start -p 3101` with `ORBIS_ALLOWED_EMAILS=''`; port 3000 is taken on the owner's machine), a seed test (three expenses, one journal entry, three social posts through the UI), then each of `/active`, `#money`, `#money/investments`, `#health`, `#journal`, `#social`, `#career`, `#profile` and Ask opened, at 390×844 (isMobile) and 1440×900, dark and light.

## Global Constraints

- Breakpoint, in CSS and in `lib/shell/desktop.ts` (`DESKTOP_QUERY`), kept identical: `(min-width: 1100px) and (pointer: fine), (min-width: 1100px) and (min-height: 541px)`. The second clause mirrors `glass.css`'s existing "not a short touch screen" guard, so the phone full-screen query `(pointer: coarse) and (max-height: 540px)` never overlaps it.
- Below the breakpoint nothing changes: no phone selector is edited, desktop rules live only inside the desktop media query in `desktop.css`, and new markup is `display: none` there.
- No branching on `window` during render. JS reads `matchMedia(DESKTOP_QUERY)` only inside event handlers.
- Hash routing stays: `hashFor`, `openingFromUrl`, `#social/2026-11`, `?tab=`, `?gmail=`, `?zerodha=`, `?social=` (`lib/shell/tabs.test.ts` stays green).
- Centred frame, max width 1440px; at 1440×900 no tab is a single narrow or stretched column and nothing scrolls sideways.
- Light and dark themes; the rail is a real `nav`; palette and Settings trap focus and give it back.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` green. Restore `next-env.d.ts` after a build.

## Review Focus

- A hash link arriving on desktop (`/active#invest`, `#social/2026-11`, `?tab=career&gmail=connected`) must land on the same tab as on the phone, including Career (the Career *tab* still renders on desktop when asked for by URL, with its "Open full panel" link). Covered by Task 1's `appHref` round-trip tests and Task 9's e2e.
- Ask Orbis opened from a card's "Ask Orbis" button (the `orbis:ask` event) on desktop must open the docked panel, not a hidden full-screen sheet. Task 3 docks `.talk-sheet` whatever opened it.
- Settings opened at a section (`?tab=settings`, Today's setup checklist, a heads-up's `adjust_routine`) must show that section on desktop, not "You". Task 4 seeds the shown section from the `section` prop and follows it when it changes.
- Escape with Ask open over Settings closes Ask first (existing rule in `settings-sheet.tsx`); the desktop focus trap must not break it. Task 4 keeps the existing Escape handler untouched.
- A window between 721px and 1099px wide still gets today's phone mock-up, unchanged. Task 10's screenshots include it implicitly via the 390 comparison; the media query is the guard.

---

## File structure

- Create `lib/shell/desktop.ts` — `DESKTOP_QUERY`, `isDesktop()`.
- Modify `lib/shell/tabs.ts` — `appHref(tab)`; tests in `lib/shell/tabs.test.ts`.
- Create `lib/shell/palette.ts` + `palette.test.ts` — the app palette's items and ranking (pure).
- Create `components/shell/dialog-focus.ts` — `useDialogFocus` moved out of `components/career/panel/panel-bits.tsx` (re-exported there).
- Create `components/shell/palette-dialog.tsx` — the combobox dialog shared by the app and Career (`components/career/panel/command-palette.tsx` becomes a wrapper).
- Create `components/shell/desktop-rail.tsx`, `components/shell/desktop-header.tsx`.
- Modify `components/app-shell.tsx` — render rail + header, `data-tab`/`data-money` on `.stage`, palette state.
- Modify `lib/ask/about.ts` + `components/assistant/talk-to-orbis.tsx` — `openAskPanel()` / `ASK_OPEN_EVENT`.
- Modify `components/settings/settings-sheet.tsx` — shown section state, `aria-current` on the jump buttons, a veil, desktop-only Tab trap.
- Modify `components/today/headsups.tsx` — optional `empty` prop for the header popover.
- Create `app/styles/desktop.css`; import it last in `app/(orbis)/layout.tsx`.
- Modify `components/career/panel/panel-rail.tsx` + `career-panel.css` — the app's tabs in the panel rail.
- Modify `tests/e2e/support/fixtures.ts`; create `tests/e2e/responsive/desktop.spec.ts`.

### Task 1: Pure routing and palette logic

**Files:** Create `lib/shell/desktop.ts`, `lib/shell/palette.ts`, `lib/shell/palette.test.ts`; modify `lib/shell/tabs.ts`, `lib/shell/tabs.test.ts`.

**Interfaces — Produces:**
- `appHref(tab: TabId, money?: MoneyView): string` — `'/active' + (hashFor(tab, money) || '#today')`.
- `type AppPaletteItem = { id: string; label: string; detail: string; kind: 'tab' | 'view' | 'settings' | 'career' | 'action'; go: PaletteGo }`, `type PaletteGo = { to: 'tab'; tab: TabId; money?: MoneyView } | { to: 'settings'; section: SettingsSection } | { to: 'href'; href: string } | { to: 'ask' }`.
- `appPalette(careerPages: ReadonlyArray<{ id: string; label: string }>): AppPaletteItem[]` — tabs (Career → `{ to: 'href', href: '/active/career' }`), Money's two views, every `SETTINGS_SECTIONS` entry, each career page (`/active/career#/<id>`), and "Ask Orbis".
- `rankPalette<T extends { label: string; detail: string }>(items: readonly T[], query: string, limit = 12): T[]` — every word must appear in label+detail; label-starts first, then label-contains, then the rest; empty query returns the first `limit` items.

- [x] **Step 1: Failing tests.** `appHref('today') === '/active#today'`, `appHref('money','investments') === '/active#money/investments'`, and for every tab `openingFromUrl(new URL(appHref(t), 'https://x').hash, null)?.tab === t`. Palette: `rankPalette(appPalette([]), 'inv')[0].label === 'Investments'`; `rankPalette(items, 'set sec')[0]` is Settings › Security; `appPalette([]).find(i => i.label === 'Career')?.go` equals `{ to: 'href', href: '/active/career' }`; ids are unique; an unmatched query returns `[]`.
- [x] **Step 2:** `pnpm test lib/shell` — fails (missing exports).
- [x] **Step 3:** Implement. `DESKTOP_QUERY` string as in Global Constraints; `isDesktop()` returns `typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches`.
- [x] **Step 4:** `pnpm test lib/shell` — passes.
- [x] **Step 5:** Commit.

### Task 2: One palette dialog for the app and Career

**Files:** Create `components/shell/dialog-focus.ts`, `components/shell/palette-dialog.tsx`; modify `components/career/panel/panel-bits.tsx` (re-export `useDialogFocus`), `components/career/panel/command-palette.tsx`.

**Interfaces — Produces:** `PaletteDialog<T extends { id: string; label: string; detail: string }>({ label, inputLabel, placeholder, results, query, onQuery, describe, onPick, onClose, empty })` where `describe(item) => { word: string; Icon: LucideIcon }` and `empty(query) => ReactNode`. Markup and classes are today's `.cp-palette*` / `.cp-veil` unchanged, so Career looks identical.

- [x] **Step 1:** Move `FOCUSABLE` + `useDialogFocus` verbatim; `panel-bits.tsx` re-exports it.
- [x] **Step 2:** Lift the combobox (arrow keys, Enter, `aria-activedescendant`, pointer pick) into `PaletteDialog`; `CommandPalette` keeps its props and passes `searchPalette` results and its `KIND` map.
- [x] **Step 3:** `pnpm typecheck && pnpm lint` — clean. Commit.

### Task 3: The desktop frame — rail, header, palette, Ask docked

**Files:** Create `components/shell/desktop-rail.tsx`, `components/shell/desktop-header.tsx`, `app/styles/desktop.css`; modify `components/app-shell.tsx`, `app/(orbis)/layout.tsx`, `lib/ask/about.ts`, `components/assistant/talk-to-orbis.tsx`, `components/today/headsups.tsx`.

**Interfaces:**
- Consumes: `appPalette`, `rankPalette`, `PaletteDialog`, `DESKTOP_QUERY` (Tasks 1–2).
- Produces: `DesktopRail({ tab, onTab, onSettings, onAsk })` — `<nav className="dk-rail" aria-label="Orbis">`: Today/Money/Health/Journal/Social as buttons (`aria-current="page"` on the open one, label as name and tooltip `.cp-tip`), Career as `<a href="/active/career">`; a second list with Ask Orbis and Settings. `DesktopHeader({ name, onSearch, onHeadsup })` — `<header className="dk-header">`: greeting (`Good morning|afternoon|evening, <name>` from `partOfDay(istParts(now).hour)`, `suppressHydrationWarning`) over the IST date; a search button (`aria-keyshortcuts="Control+K Meta+K"`, `<kbd>` hint) that opens the palette; a heads-ups bell popover rendering `<Headsups onAction empty={…}/>` only while open; `ThemeToggle`; `SettingsButton`. `openAskPanel()` dispatches `ASK_OPEN_EVENT = 'orbis:ask-open'`; `TalkToOrbis` opens on it.
- `.stage` gets `data-tab={tab}` and `data-money={money}`.

- [x] **Step 1:** Before any CSS: take the baseline 390×844 screenshots (Task 10 harness) from this commit.
- [x] **Step 2:** Components and shell wiring. Ctrl/⌘+K opens the palette from anywhere in the app (a listener in `app-shell.tsx` like `usePaletteShortcut`, but it only acts when `isDesktop()`, so the phone layout keeps every key). Picking: `tab` → same path as a rail click; `settings` → `setSettings(section)`; `href` → `window.location.assign`; `ask` → `openAskPanel()`.
- [x] **Step 3:** `desktop.css`, all inside the desktop query: `.stage` becomes a block with the wallpaper fixed behind it; `.intro`, `.ambient`, `.phone-speaker`, `.bottom-nav`, `.talk-fab` hidden; `.phone`/`.phone-screen` lose frame, radius, height and clipping; `.dk-frame` = max-width 1440, centred, left padding for the 60px rail; window scrolls (`.screen-body` height auto, overflow visible, side padding 0); `.dk-rail` styled like `.cp-rail` (fixed, vertically centred, gradient on `aria-current`); header a 3-column grid; screen-level duplicate chrome hidden (`.fd-top` on Today, the `.avatar` in `.fd-head-row`); `.talk-sheet` fixed to the right (`width: 420px`, top/bottom 16px, radius 24px) and `.stage:has(.talk-sheet) .dk-frame` gives it room. Below the breakpoint `.dk-rail, .dk-header { display: none }`. Default `.screen-body` on desktop: a centred column of `max-width: 760px` (sub-pages and forms).
- [x] **Step 4:** `pnpm typecheck && pnpm lint && pnpm test`; look at 1440 and 390 in the browser. Commit.

### Task 4: Settings as a large dialog with sections down the left

**Files:** Modify `components/settings/settings-sheet.tsx`, `app/styles/desktop.css`.

- [x] **Step 1:** `const [shown, setShown] = useState(section)`, re-synced when `section` changes; jump buttons set it and still `jumpTo`; `aria-current="true"` on the shown one; each `Group` gets `data-shown` when it is the shown one. A `<div className="settings-veil" onClick={onClose} aria-hidden="true">` rendered beside the dialog. On Tab inside the dialog, if `isDesktop()`, keep focus inside (same loop as `useDialogFocus`). Phone: the veil is `display: none`, unknown attributes change nothing, the trap never runs.
- [x] **Step 2:** Desktop CSS: veil fixed and dim; `.settings-sheet` fixed, `inset: 40px`, `max-width: 1080px`, centred, radius 24px, grid `220px 1fr` — header across, `.settings-jump` a vertical sticky list on the left, groups on the right with `.pf-group:not([data-shown])` hidden.
- [ ] **Step 3:** Check open/close, Escape, Tab loop, `?tab=settings` landing on Connections. (Opening at a section is seen in screenshots; the keyboard checks have not been run in a real browser yet.)

### Task 5: Today (first pass done, polish open)

**Files:** `app/styles/desktop.css`.

- [ ] Grid on `[data-tab="today"] .screen-body`: `minmax(0,1fr) minmax(0,1fr) 340px`, rows `repeat(12, auto) 1fr` (the trailing `1fr` row lets the side column span without opening gaps in the main ones). Brief (`.fd-note-brief`/focus note), passkey prompt and routine check across columns 1–2; `.hu-card` and `.setup-list` in column 3 from row 1 down; widgets across 1–2; career row, weather, mail, news auto-placed into the two main columns. Screenshot at 1440 light + dark. Commit.

### Task 6: Money (first pass done, polish open)

**Files:** `app/styles/desktop.css`.

- [ ] Spending (`[data-money="spending"]`): two columns `minmax(0,1.1fr) minmax(0,1fr)`; title, switch, hero row and notices across; month summary, money in and currency on the left; the latest-transactions block on the right spanning down. Investments: hero, focus, positions and news left; health of the mix, allocation, accounts, own investments and AI row right (label + body pairs stay together by placing labels and bodies in the same column). First-run views fall back to the centred column. Screenshot both views. Commit.

### Task 7: Health and Journal (first pass done, polish open)

**Files:** `app/styles/desktop.css`.

- [ ] Health: title across; two columns — workouts/plans and steps left, documents, saved advice, coaching and Ask right. Journal: the entry form and history left (`minmax(0,1.4fr)`), saved notes right. Screenshot. Commit.

### Task 8: Social (first pass done, polish open)

**Files:** `app/styles/desktop.css`.

- [ ] Title, notices and the two add actions across; the month planner (`.so-cal*` card) across the full width so the month view has its room; posts and insights side by side below. Screenshot week and month views. Commit.

### Task 9: Career link-up (done)

**Files:** Modify `components/career/panel/panel-rail.tsx`, `app/styles/career-panel.css`, `app/styles/desktop.css`.

- [x] Panel rail gains a third list, `.cp-rail-apps`, of the app's other tabs as `<a href={appHref(tab)}>` with icons and tooltips (Today, Money, Health, Journal, Social); `display: none` below 900px, where the existing "Back to the app" link stays the way back (and is hidden at 900px+ where the tabs replace it). The `/active` rail's Career link is marked current when the Career tab is open (it was reached by URL). The Career tab, when shown on desktop, sits in the centred column. Commit. (The app links render only with `DESKTOP_LAYOUT` on, so the panel on `main` is unchanged while the switch is off. Checked at 1440, 1000 and 390: links shown and Back hidden at 900px+, the bottom bar unchanged below; a rail click lands on `#money`; the `/active` rail marks Career current on `#career`.)

### Task 10: Verification (harness and phone comparison done; e2e changes and final shots open)

**Files:** Modify `tests/e2e/support/fixtures.ts` (`openTab` accepts a button *or* link in the nav; Career at desktop width opens `/active#career` directly, since the rail's Career leaves for the panel); create `tests/e2e/responsive/desktop.spec.ts` (at 1440: rail is the only `navigation`, no phone frame, no sideways scroll on any tab, Ctrl+K opens the palette and Escape returns focus; at 390: the bottom nav is there and the rail/header are not).

- [ ] **Step 1:** Screenshot harness outside the repo (scratchpad Playwright config reusing `tests/e2e/support/global-setup.ts` / `global-teardown.ts` against `pnpm start -p 3101`): every tab, Money/Investments, Settings, Ask open, at 1440×900 and 390×844, light and dark at 1440.
- [ ] **Step 2:** Pixel-compare the 390 shots with the Task 3 Step 1 baseline.
- [ ] **Step 3:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; `git checkout -- next-env.d.ts`. Commit the e2e changes.
