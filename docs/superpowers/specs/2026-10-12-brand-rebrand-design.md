# Orbis visual rebrand — design

Source of truth for the brand: [docs/design/orbis-brand-prompt.md](../../design/orbis-brand-prompt.md).

## Goal

Make the whole app look like the Orbis brand system (dark-first, DM Sans, teal/blue gradient, gradient-ring logo) without changing routing, data, auth or behaviour. Today's tabs stay: Today, Money, Health, Journal, Social.

## Decisions

- **Scope:** visual rebrand only. No tab restructure.
- **Theme:** dark is the default for everyone, regardless of OS setting. Light stays selectable through the existing theme toggle (`data-theme="light"`), re-tinted to the brand. *(Assumption: the user approved the design without answering this; reverse by restoring the `prefers-color-scheme` gate.)*
- **Approach:** remap the existing CSS token layer in `app/styles/01-base.css`, then move hard-coded colours onto tokens. No per-screen rewrites.

## Changes

1. **Tokens** (`01-base.css`, `glass.css`, `glass-dark.css`)
   - Dark values: background `#0E0E10`, surface 1 `#141416`, surface 2 `#1A1A1E`, border `#242428`; teal `#42CCA8`, blue `#5BB4E8`, green `#3DC87A`, red `#F26B6B`, gold `#F0B429`.
   - Brand gradient `linear-gradient(135deg, #5BB4E8, #42CCA8)` as a token; used by primary buttons, active tab, user chat bubbles.
   - Light theme: same hues, darkened where needed to keep AA text contrast.
   - Chart series rebuilt on brand colours, keeping contrast and fixed ordering.
   - Legacy aliases (`--bg`, `--ink`, `--accent` …) stay so existing rules follow.
2. **Font:** Figtree → DM Sans (300, 400, 500, 600) via `next/font/google` in `app/layout.tsx`. `--font-text` and `--rounded` both resolve to it. Scale: display 28–32/600, heading 18–20/600, body 14–15/400, label 11–12/500 uppercase 0.5px tracking.
3. **Shape:** cards 16px radius with 1px `#242428` border on surface 1/2; pills 20px radius with teal/blue/red/gold fills (adjust `--r-*` tokens and the card/pill classes).
4. **Bottom nav:** 60px high, 20px icons, 10px labels, active tab on the teal gradient (`components/app-shell.tsx` and its CSS).
5. **Logo:** `components/brand/orbis-mark.tsx` becomes a conic-gradient `div` ring (`#5BB4E8` → `#42CCA8` → `#3DC87A`) with an inner hole `div` at 45% of the diameter. No SVG stroke. Raster icons (`favicon.ico`, `icon.png`, `apple-icon.png`, `public/brand/*`) regenerated from the same ring if an image tool is available; otherwise listed for manual export.
6. **Hard-coded colours** (~150 hex values, mainly `01-base.css`, `atlas-social.css`, `glass.css`, `marketing.css`) moved onto tokens. Waitlist black hole colours aligned to the logo palette.
7. **`themeColor`** in `app/layout.tsx` updated to the brand background.

## Out of scope

Routing, data, auth, feature behaviour, the spec's phone-frame mockup chrome, the Home/Health/Money/AI/Settings tab structure.

## Testing

- `pnpm typecheck`, `pnpm lint`, `pnpm test:public` (CSP, 250 KB JS budget, a11y, no-leak) pass.
- Visual check of each tab, login and waitlist, dark and light, at phone width.
- Contrast check on the new text/surface pairs.

## Risks

- Text colours that passed on iOS surfaces may fail on the new ones; verify each pair.
- Raster icon regeneration may not be possible in this environment.
