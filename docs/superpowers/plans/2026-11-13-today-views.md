# Today Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On desktop, Today offers two views, Classic (unchanged) and Glass (mockup R2·01). The choice is remembered per browser. Phones always see Classic.

**Architecture:**
- `TodayScreen` keeps loading everything as now.
- On desktop it reads the saved view and renders either today's body (Classic) or a new `GlassView` that takes the same data as props.
- `GlassView` sits inside an error boundary that falls back to Classic.
- Pure logic (saved-view parsing, hourly temperatures, the curve, activity and rest-of-today) lives in `lib/home/` and is unit-tested with Vitest.
- `WeatherCard` and `NewsCard` gain a `variant="glass"` look, so they keep their own fetching and caching.

**Tech Stack:** Next.js client components (read `node_modules/next/dist/docs/` before touching routing; see AGENTS.md), Vitest with `node:assert/strict`, Open-Meteo through `lib/providers/weather.ts`, plain CSS with theme tokens.

**Spec:** `docs/superpowers/specs/2026-11-13-today-views-design.md` (approved 2026-11-13).

## Global Constraints

- Classic is today's Today, **unchanged**: no markup or CSS of the current body changes, apart from rendering it from a new branch.
- **Desktop only:** the switch shows and Glass renders only when `isDesktop()` (`lib/shell/desktop.ts`) is true. Otherwise it's Classic, always.
- Saved view: `localStorage` key `orbis.today.view`, values `'classic' | 'glass'`. Anything else, or storage that throws, means `'classic'`.
- **No sample numbers.** A widget whose data is missing is not rendered.
- **Hallmark rules on the new CSS:**
  - theme tokens only (`--fd-*`, `--brand-*`), no literal colours outside a token block;
  - no tracked or uppercase labels, no middle-dot joined meta, no status dots;
  - `:focus-visible` on every control;
  - animation only with a `prefers-reduced-motion` fallback.
- **Class prefix `tg-`** for every new Glass class (`st-` and `studio-` are taken).
- Commit per task on branch `today-views` in a worktree. At the end, merge into `main` and push (the owner's standing rule).

## Review Focus

1. **Steps from an old day** (the latest synced date isn't today) must not show as today's. The Activity widget shows "No steps synced today" instead. → Task 1 test `glassActivity ignores steps from another day`.
2. **Open-Meteo returns fewer than 4 future hours, or null temperatures.** The curve hides rather than drawing from bad points. → Task 1 test `nextHours drops nulls and past hours`, and `curvePoints returns [] under 2 hours`.
3. **Resizing a desktop window to phone width while on Glass** must show Classic, with no switch. → Task 5: `isDesktop` is re-read on `resize` via `matchMedia` change.
4. **A Glass render error** (for example news with an unexpected shape) must leave a working Classic Today. → Task 4 error boundary; checked by hand with a forced throw.
5. **Storage blocked** (Safari private mode, `localStorage` throws) means Classic, and the switch still works for the visit. → Task 1 test `readTodayView returns classic for junk`; Task 5 wraps reads and writes in try/catch.

---

### Task 1: Pure helpers (saved view, hours, curve, activity, rest of today)

**Files:**
- Create: `lib/home/today-view.ts`, `lib/home/hours.ts`, `lib/home/glass.ts`
- Test: `lib/home/today-view.test.ts`, `lib/home/hours.test.ts`, `lib/home/glass.test.ts`

**Interfaces (produced):**
- `TODAY_VIEW_KEY = 'orbis.today.view'`; `type TodayView = 'classic' | 'glass'`; `readTodayView(raw: string | null): TodayView`.
- `type HourTemp = { hour: string; temperature: number }`.
- `hourLabel(iso: string): string`, moved here from `lib/providers/weather.ts` unchanged ("9 pm", "noon", "midnight").
- `nextHours(times: string[], temps: Array<number | null | undefined>, nowHour: string, count = 12): HourTemp[]`, where `nowHour` is `'YYYY-MM-DDTHH'` and temperatures are rounded.
- `curvePoints(hours: HourTemp[], width: number, height: number, pad = 6): Array<{ x: number; y: number }>`: x is spread evenly, y is inverted and scaled between min and max. It returns `[]` when there are fewer than 2 hours.
- `curveLabels(hours: HourTemp[], count = 4): HourTemp[]`: evenly spaced, the first and last included.
- `STEP_GOAL = 10_000` (also used by `today-widgets.tsx`).
- `glassActivity(input: { latest: { date: string; steps: number } | null; today: string; done: number; total: number }): { steps: number | null; stepShare: number; routineShare: number; done: number; total: number }`. Steps are null unless `latest.date === today`. Shares are clamped to 0–1, and `routineShare` is 0 when `total` is 0.
- `restOfToday(due: RoutineToday[], max = 4): Array<{ id: string; name: string; time: string }>`: routines with `minutesAway > 0` and no event, in time order, `time` as `routine.atTime`.

- [ ] **Step 1: Write the failing tests**

```ts
// today-view.test.ts
test('readTodayView keeps glass and classic', () => { assert.equal(readTodayView('glass'), 'glass'); assert.equal(readTodayView('classic'), 'classic'); });
test('readTodayView returns classic for junk', () => { for (const raw of [null, '', 'Glass', 'grid']) assert.equal(readTodayView(raw), 'classic'); });
// hours.test.ts
test('nextHours drops nulls and past hours', () => {
  const out = nextHours(['2026-11-13T12:00','2026-11-13T13:00','2026-11-13T14:00','2026-11-13T15:00'], [27, 28.4, null, 29.6], '2026-11-13T13');
  assert.deepEqual(out, [{ hour: '1 pm', temperature: 28 }, { hour: '3 pm', temperature: 30 }]);
});
test('nextHours stops at count', () => { /* 30 hourly entries → 12 */ });
test('curvePoints returns [] under 2 hours', () => assert.deepEqual(curvePoints([{ hour: '1 pm', temperature: 28 }], 300, 60), []));
test('curvePoints puts the warmest hour at the top and the coldest at the bottom', () => { /* ys equal pad and height-pad */ });
test('curveLabels keeps the first and last of 12 and returns 4', () => { /* hours 0 and 11 included, length 4 */ });
// glass.test.ts
test('glassActivity ignores steps from another day', () => {
  const a = glassActivity({ latest: { date: '2026-09-28', steps: 2772 }, today: '2026-11-13', done: 1, total: 4 });
  assert.equal(a.steps, null); assert.equal(a.stepShare, 0); assert.equal(a.routineShare, 0.25);
});
test('glassActivity uses today’s steps and clamps the share', () => { /* 12,500 steps → stepShare 1 */ });
test('restOfToday keeps upcoming unanswered routines in order, at most 4', () => { /* answered and past ones dropped */ });
```

- [ ] **Step 2: Run them and check they fail**: `pnpm vitest run lib/home/today-view.test.ts lib/home/hours.test.ts lib/home/glass.test.ts` → FAIL (modules missing).
- [ ] **Step 3: Implement the three modules.** Use relative `.ts` imports and type-only imports, so they load under plain Node.
- [ ] **Step 4: Run them**: same command → PASS.
- [ ] **Step 5: Commit**: `git commit -m "Today views: saved view, hourly curve and activity helpers"`

---

### Task 2: Hourly temperatures from the weather provider

**Files:**
- Modify: `lib/providers/weather.ts` (request `&hourly=precipitation_probability,temperature_2m`; add `hours: HourTemp[]` to `Weather`, built with `nextHours(times, body.hourly?.temperature_2m ?? [], nowHour)`; import `hourLabel` from `lib/home/hours.ts` and remove the local copy)
- Modify: `lib/home/weather.ts` (`BriefWeather` gains `hours?: HourTemp[]`, optional so cached entries without it still parse)

- [ ] **Step 1: Make the change.** The route spreads `weather.data`, so `/api/weather` carries `hours` with no route change.
- [ ] **Step 2: Verify**: `pnpm tsc --noEmit -p . && pnpm vitest run lib/home lib/providers` → clean and PASS (the Task 1 hour tests cover the parsing).
- [ ] **Step 3: Commit**: `git commit -m "Weather: the next 12 hours of temperature"`

---

### Task 3: Glass looks for the weather and news cards

**Files:**
- Modify: `components/today/weather-card.tsx`, `components/today/news-card.tsx`

**Interfaces:**
- `WeatherCard` props gain `variant?: 'line' | 'glass'` (default `'line'`, today's output unchanged).
- `NewsCard({ variant?: 'magazine' | 'glass' })` (default `'magazine'`, unchanged).

- [ ] **Step 1: `WeatherCard variant="glass"`, ready state.** Wrap in `<section className="tg-weather" data-sky={sky}>`:
  - `sky` is `'night'` when `!isDay`, `'rain'` when the condition is precipitating, `'cloud'` for codes 1–48, else `'clear'`.
  - The place and condition on one line.
  - The temperature, class `tg-weather-temp`.
  - "Feels {feelsLike}°, humidity {humidity}%, wind {windSpeed} km/h", joined with commas, never middle dots.
  - When `curvePoints(hours, 420, 70)` has points: an `<svg role="img" aria-label="Temperature over the next hours, from {first}° to {last}°">` polyline, then `curveLabels` as "3 pm 29°" spans.
  - The rain note from `rainNote` when present.
  - Loading, needs-city and error states reuse today's markup inside the glass section.
- [ ] **Step 2: `NewsCard variant="glass"`.**
  - When ready: one `<a className="tg-story">` for `articles[0]` with `NewsPhoto`, the headline, and "{source}, {ago}".
  - Then, when `analysis` exists, a `<section className="tg-market">` with `market.summary` and each sector: the outlook icon, the sector name and the `why`.
  - Loading shows a quiet line. Error or not configured renders nothing.
- [ ] **Step 3: Verify**: `pnpm tsc --noEmit -p . && pnpm lint` → clean. The Classic output is identical: the default branches are untouched.
- [ ] **Step 4: Commit**: `git commit -m "Today: glass looks for the weather and news cards"`

---

### Task 4: GlassView, its styles and the fallback

**Files:**
- Create: `components/today/glass-view.tsx`, `components/today/view-boundary.tsx`, `app/styles/page-today-glass.css` (import in `app/(orbis)/layout.tsx` right after `page-today.css`)

**Interfaces:**
- `ViewBoundary({ fallback, children }: { fallback: ReactNode; children: ReactNode })`: a class component. On error it renders `fallback` and logs `console.error('Today glass view failed', error)`.
- `GlassView(props: { brief: HomeNote; today: string; portfolio: BriefPortfolio | null; activity: ReturnType<typeof glassActivity>; rest: ReturnType<typeof restOfToday>; onWeather; onPhase; openTab; openHeadsup; extras: ReactNode })`. `extras` holds the routine check, the Gmail notice, the setup checklist and the privacy line, rendered below the grid.

- [ ] **Step 1: Build `GlassView`.** The markup follows the spec's grid:
  - The lead: `<FocusNote note={brief} />` and `today`.
  - Then `.tg-grid` (12 columns) with:
    - Weather (`<WeatherCard variant="glass" …/>`, 5 columns, 2 rows);
    - Portfolio (4 columns; `null` or `state === 'off'` → not rendered). The total uses `formatMoney` from the person's currency (use the formatter `today-widgets.tsx` already uses). The day change is coloured with `--brand-green` or `--brand-red`, with the coverage note when coverage < 1.
    - Activity (3 columns): an SVG with two rings (`stepShare`, `routineShare`), then "{steps} steps" or "No steps synced today", then "{done} of {total} routines";
    - Rest of today (4 columns; empty → not rendered);
    - `<NewsCard variant="glass" />` split as Market read (3 columns) and Top story (7 columns), through two grid areas;
    - Needs you (5 columns: `<Headsups/>` and `<ImportantMail/>` in one panel; when both render nothing, the panel's `:empty` CSS hides it).
- [ ] **Step 2: Write `page-today-glass.css`.**
  - The `.tg-` classes only.
  - The glass surface: `color-mix` of `--fd-card` with transparency, a 1px `--fd-rule` edge, `backdrop-filter: blur(24px)`, radius 28px.
  - Sky tints through `[data-sky]` using `color-mix` of `--brand-blue`, `--brand-teal`, `--brand-violet` and `--fd-card`.
  - Below 1100px the grid becomes one column. Glass doesn't render there anyway.
  - `@media (prefers-reduced-motion: reduce)` for any transition.
- [ ] **Step 3: Verify**: `pnpm tsc --noEmit -p . && pnpm lint` → clean.
- [ ] **Step 4: Commit**: `git commit -m "Today: the Glass view and its fallback"`

---

### Task 5: The switch in TodayScreen

**Files:**
- Modify: `components/today/today-screen.tsx`, `components/today/today-widgets.tsx` (import `STEP_GOAL` from `lib/home/glass.ts`)

- [ ] **Step 1: Desktop and saved view.**
  - Add `const desktop = useDesktop()`, a small hook in `components/today/use-desktop.ts`: `useSyncExternalStore` over `matchMedia(DESKTOP_QUERY)` changes. Export `DESKTOP_QUERY` from `lib/shell/desktop.ts` if it isn't already. The server snapshot is `false`.
  - Add `const [view, setView] = useState<TodayView>('classic')`, read once after mount with `readTodayView(localStorage.getItem(TODAY_VIEW_KEY))` in try/catch.
  - `chooseView(next)` sets the state and writes the key in try/catch.
- [ ] **Step 2: Render.**
  - Move today's body (from `<div className="td-lead">` to the end) into a `classic` const, unchanged.
  - When `desktop`, put a `role="radiogroup" aria-label="Today view"` control with "Classic" and "Glass" (class `tg-switch`) in `.fd-top`, before the actions.
  - Render `desktop && view === 'glass' ? <ViewBoundary fallback={classic}><GlassView …/></ViewBoundary> : classic`.
  - Build `activity` from `glassActivity({ latest: stepsSummary.latest, today: localDate(new Date(), timeZone), ...settledToday(due) })`, with the exact field names checked against `settledToday`'s return. Build `rest` from `restOfToday(due)`.
- [ ] **Step 3: Verify**:
  - `pnpm vitest run && pnpm tsc --noEmit -p . && pnpm lint && pnpm build` → all pass.
  - In the owner's browser: on desktop, switch to Glass, reload (it stays), switch back. At phone width there's no switch and Classic shows.
- [ ] **Step 4: Commit**: `git commit -m "Today: Classic and Glass views on desktop"`

---

### Task 6: Wrap-up

- [ ] **Step 1:** Run the full checks again.
- [ ] **Step 2:** Get a fresh-context review of the branch against this plan and its Review Focus.
- [ ] **Step 3:** Fix the review's findings.
- [ ] **Step 4:** Merge into `main`, push, and remove the worktree.
