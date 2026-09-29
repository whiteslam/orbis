# App reorganisation: five tabs, one assistant, one settings home

Date: 2026-09-29 · Status: draft for review

## Why

Orbis grew feature by feature and its structure did not keep up.

- **Profile is a junk drawer.** It holds Journal, Ask Orbis, personal data and eight settings groups (about 70 % settings), and lands on Journal.
- **Connections are shown in three places:** Settings → App integrations, Settings → Data services, and Invest. Profile's identity chips restate them a fourth time.
- **Features sit away from where they are used:**
  - Routines are configured in Settings but used on Home.
  - Coaching style is in Profile but read only by Health.
  - The switch that gates *all* AI sits inside the Home-brief setting.
  - PIN and passkey have no settings entry at all.
- **Two unrelated "Ask" features:** Health's file Q&A and Profile's records Q&A. The voice mic is a third entry point.
- **Six tabs;** Expense and Invest are both money.
- **Code:**
  - `components/orbis-app.tsx` (595 lines) inlines four screens.
  - Each tab has three names: id `investment`, label "Invest", hash `#invest`.
  - `components/personal/` is a catch-all.
  - `app/globals.css` is 1,615 lines with ~15 class prefixes.
  - Dead imports and props, and `goals`/`habits` tables with no UI.
  - The README and BUILD_ROADMAP describe features that have since changed.

Success means:

1. Every feature has one home, next to where it is used.
2. Settings are reachable from every screen and grouped by what they control.
3. Every tab has one name, used in code, label and URL.
4. No file over 400 lines in the shell, and CSS split by feature.
5. Every existing link and test keeps working, or is deliberately updated.

## Target layout

### Tabs (5) + global assistant

| Tab (id = hash) | Label | Contents |
|---|---|---|
| `today` | Today | Setup checklist (new), focus brief, routine check, weather, important mail, quiet rows. Header: date, theme, **avatar → Settings** |
| `money` | Money | Segmented control: **Spending** (the current Expense screen) · **Investments** (the current Invest dashboard). Hash state: `#money/investments` |
| `health` | Health | As today, plus **Coaching style** (moved from Profile). "Ask about a file" stays here, renamed so it is not confused with the assistant |
| `journal` | Journal | Journal (with voice notes and history), **Saved notes** (moved from Profile) |
| `social` | Social | Unchanged |

**Assistant.** The floating mic becomes the one Ask Orbis entry point. The panel gets a text field beside the mic, so typing and talking share one conversation. The source chips from today's Ask Orbis move into the panel. Profile → Ask is removed.

**Settings.** A full-screen sheet opened from the avatar on every tab's header. It replaces Profile. The sections, in order:

1. **You:** name and about you (ProfileEditor), location
2. **Connections:** one list of Gmail/Calendar, Zerodha, Groww and Apple Health. Each row shows a *Read-only* badge, status, what it reads, last sync, and Connect/Reconnect/Disconnect. This replaces App integrations, Data services and the identity chips. Invest keeps a small status line that links here.
3. **AI & privacy:** the global AI switch and consent (AiConsent) first, the Home brief toggle second
4. **Notifications**
5. **Your day:** routines
6. **Security:** PIN set/change/remove, passkey, lock now. This wires the existing security components into a visible home.
7. **Your data:** post history, export, delete account, sign out

### Compatibility

- **Old hashes keep working:** `#home` → Today, `#finance` → Money/Spending, `#invest` → Money/Investments, `#profile` → Today with Settings open.
- **Old `?tab=` links keep working:** `?tab=` values `home`, `finance`, `invest` and `settings` keep working. The Gmail and Zerodha OAuth callbacks are updated to the new values (`today`, `money`, `settings`), and the old values stay accepted.
- **PWA shortcuts:** the manifest shortcuts in `app/manifest.ts` are updated to the new hashes.
- **Deep links:** `#social/2026-09`-style tab state keeps working.

## Code organisation

```
components/
  app-shell.tsx            tabs, URL/hash routing, settings sheet host (≤ 250 lines)
  tabs.ts                  the one Tab list: id, label, icon, legacy aliases
  today/                   today-screen.tsx + home/* (routine-check, weather, mail)
  money/                   money-screen.tsx + finance/* + invest/*
  health/                  health-screen.tsx + existing health/*
  journal/                 journal-screen.tsx, journal, voice-notes, history-panel, context-notes
  social/                  unchanged
  settings/                settings-sheet.tsx + one file per section
  assistant/               talk-to-orbis (renamed assistant-panel) + ask-orbis pieces
app/
  styles/                  base.css, shell.css, today.css, money.css, health.css,
                           journal.css, social.css, settings.css, assistant.css, auth.css
```

- `orbis-app.tsx` becomes `app-shell.tsx`. Each screen moves to its own file, unchanged except for imports.
- **Server actions stay where they are.** Moving them changes action IDs and buys nothing. Only `app/personal/*` is renamed to `app/journal/*` and `app/settings/*` to match.
- **CSS:**
  - `globals.css` is split by feature into `app/styles/`, which `app/layout.tsx` imports in order.
  - Class names are not renamed in this project; renaming 1,600 lines of selectors is high-risk and low-value.
  - Duplicate `fd-` rules in `atlas-profile.css` are merged.
- **Dead code removed:**
  - The unused imports (`Landmark`, `Sparkles`, `Focus`, `FocusSurface`) and the `savedAdviceAt` prop.
  - The root duplicates `AUDIT_REPORT.md`, `audit.json` and `audit-report.html`. The copy in `docs/audit/` is kept.
- **Docs:** the README "features by tab" section and the BUILD_ROADMAP §6a status are rewritten to match.

## Stages

Each stage is one commit (or a short series), leaves the app working, and ends with `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` green.

1. **Code split, nothing visible changes.**
   - Move screens out of `orbis-app.tsx`, introduce `tabs.ts`, and regroup the component folders.
   - Split the CSS and remove the dead code.
   - The e2e suite runs unchanged; it is the proof nothing moved for the user.
2. **Settings and Connections.**
   - Add the avatar and the settings sheet with the seven sections, and the unified Connections list.
   - Profile keeps working in parallel; its Settings section now opens the sheet.
   - New e2e: open Settings from every tab; Connections shows each provider once; Security shows PIN controls.
3. **New tabs and the global assistant.**
   - Switch to the five tabs and merge Expense and Invest into Money.
   - Move Journal, Saved notes and Coaching style.
   - Add typing to the assistant panel and remove Profile.
   - Legacy hash and `?tab=` aliases go in here.
   - The e2e specs that name "Expense", "Invest" or "Profile" are updated.
   - New e2e: every legacy hash lands on the right place.
4. **Docs and cleanup:** README, BUILD_ROADMAP, and the setup checklist on Today.

## Out of scope

- A new visual design. Screens keep their current look; only their placement changes.
- Renaming CSS classes.
- A habits UI. The `goals`/`habits`/`habit_checkins` tables stay untouched until you decide to build or drop them.
- Merging Health's file Q&A into the assistant.
- Moving server action files beyond the `personal` → `journal`/`settings` rename.

## Decisions needed from you

1. **`.worktrees/phase-1`** is a live git worktree on branch `phase-1` (commit `64dadb7`, which is already in `main`). Should it be removed with `git worktree remove`? This spec does not touch it unless you say so.
2. **Social as a main tab.** It is a content planner you may open less than daily. Keep it as a tab (this spec's default), or move it into Today as a row and make **Assistant** the fifth tab?
