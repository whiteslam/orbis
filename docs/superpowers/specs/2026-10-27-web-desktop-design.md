# Orbis on a laptop: the desktop web layout

Date: 2026-10-27 · Status: **approved by the owner in chat** · Scope: how the signed-in app at `/active` looks and works on a laptop or desktop screen.

## Why

On a computer, `/active` still draws the phone: a framed phone in the middle of the page, the six tabs in a bottom bar, the intro text beside it. Only Career has a real desktop page (`/active/career`), and nothing in the app leads to it except a small link inside the Career tab. The owner wants a proper web version of the **whole** app, so sitting at a laptop feels like using a web app, not a phone mock-up.

## Goals

- On a wide screen the app fills the window. No phone frame, no intro text, no bottom bar.
- Every tab uses the width: Today, Money, Health, Journal, Social, Career, and Settings.
- One look across the app, borrowed from the Career panel (`app/styles/career-panel.css`, `components/career/panel/*`): the floating pill rail on the left, the header with brand, search, notifications and avatar, glass cards, the bento grid.
- Career's full panel is reachable in one click from anywhere on desktop, and the panel leads back to the other tabs.

## Non-goals

- No new features, data or server actions. This is layout and navigation only.
- No separate "desktop app" codebase or second set of screens to keep in sync. The same screen components serve both sizes.
- No change to auth, the app gate, the lock or the PIN.

## Anti-goals (it fails even if it "works" when…)

- The phone layout changes. Below the breakpoint, every screen must look and behave exactly as it does today.
- Desktop is a stretched phone: one 1400px-wide column of cards with lines of text running edge to edge.
- Things that work on the phone stop working on desktop (Ask Orbis, heads-ups, the hash links such as `#invest` and `#social/2026-11`, the `?tab=` / `?gmail=` returns from OAuth).

## Decided

- **Same URL, same tree.** `/active` keeps one `AppShell`. The desktop layout switches on at a min-width breakpoint (the builder picks it, about 1024–1100px), mostly in CSS. JavaScript is used only where markup must differ (for example a header that the phone doesn't have), and then without a hydration flash: render both and hide one with CSS rather than branch on `window` during render.
- **Left rail.** The six tabs and Settings move into a left rail styled like `.cp-rail` (icons with tooltips/labels, the active tab in the brand gradient). Settings and Ask Orbis sit at the bottom of the rail.
- **Header.** Across the top of the content: greeting/brand on the left; a search box (Ctrl/Cmd+K) that opens a command palette to jump to any tab, Money view, Settings section or Career page (generalise or mirror `components/career/panel/command-palette.tsx`); heads-up notifications; the avatar that opens Settings.
- **Each tab gets a desktop arrangement** inside a centred frame (max width about 1440px):
  - **Today:** the brief at the top, the widgets and cards in a multi-column grid, heads-ups in a side column.
  - **Money:** Spending and Investments side by side or in a two-column bento: summary and charts on one side, the transactions/holdings list on the other.
  - **Health, Journal, Social:** two or three columns where the content allows (for Social, the month planner gets the room it needs).
  - **Career:** on desktop the rail's Career goes to the full panel at `/active/career`. The panel's own rail gains the other tabs, linking back to `/active#<tab>`, so the two feel like one app.
- **Ask Orbis** opens as a panel docked on the right on desktop, so the page stays visible while chatting. On the phone it stays the bottom sheet it is today.
- **Settings** opens as a full page/large dialog on desktop, with the sections (`SETTINGS_SECTIONS`) listed down the left and the chosen section on the right.
- **Built tab by tab:** the shared frame (rail, header, Ask panel, Settings layout) and Today first, then Money, Health, Journal, Social, and the Career panel link-up.

## Constraints

- Next.js 16 in this repo differs from older versions: read `node_modules/next/dist/docs/` before touching routing or rendering APIs (`AGENTS.md`).
- Styling is plain CSS in `app/styles/*.css`, loaded by `app/(orbis)/layout.tsx`, with tokens in `brand.css` and the glass tokens in `glass*.css`. Desktop rules go in a new sheet (for example `app/styles/desktop.css`) loaded after the others, so the phone rules stay untouched.
- Light and dark themes both have to work.
- Keyboard and screen readers: the rail is a real `nav`, focus is visible, the palette and dialogs trap and restore focus, as the Career panel already does.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` stay green; CI runs all four.

## How we'll know it worked

- Playwright screenshots of every tab at 1440×900 and at 390×844. The 390 shots match the current `main` (no phone regressions).
- At 1440 wide, no tab is a single narrow or single stretched column, and nothing scrolls sideways.
- Every link and return that works today still lands on the right tab at both sizes.

## Left to the builder

The exact breakpoint, the column splits per tab, the component boundaries (how much is CSS versus a small desktop wrapper), and how the command palette is shared with Career.
