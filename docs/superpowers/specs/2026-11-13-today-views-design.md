# Today views: a glass view beside the default

> **Changed 2026-11-14:** the owner asked for Glass "for mobile view and desktop view", so the switch and Glass now show on phones too (this replaces the desktop-only rule below). Glass runs the full width on desktop as two wrapping rows (`app/styles/page-today-glass.css`), checked against the Hallmark rules.

Date: 2026-11-13 · Status: **approved by the owner 2026-11-13** ("okey do it for only web view not for mobile view at all") · Mockups: canvas https://claude.ai/artifact/KadT7C3Cy6pjgQm7cdz6xQ, page "Round 2 (rich)", artboard R2·01 Glass · Widget board.

## Why

The owner finds Today too plain and wants more of their data on it, looking expensive rather than cluttered. They want to switch between designs instead of replacing the current one: the default must stay exactly as it is and keep working.

## Decisions

- **Two views on desktop.** View 1, **Classic**, is today's Today, unchanged. View 2, **Glass**, is R2·01: frosted widgets over the glow wallpaper.
- **Phone is untouched.** Below the desktop breakpoint (`isDesktop()` in `lib/shell/desktop.ts` is false), Today is always Classic and no switch shows.
- **The switch:**
  - It is a small segmented control, "Classic | Glass", at the top of Today on desktop.
  - The choice is remembered per browser in `localStorage` under `orbis.today.view`. That needs no database change. Unreadable storage means Classic.
  - *My call:* per browser rather than per account, since only desktops see it.
- **The view never breaks Today.** The Glass view sits inside an error boundary. If anything in it throws, Today renders Classic for that visit.
- **Same data, no new sources.** Glass reuses what Today already loads: the brief, weather, portfolio, steps, routines, mail, heads-ups and news. A widget whose data is missing is hidden, never filled with sample numbers.

## The Glass view (R2·01, adapted to real data)

- **Lead:** the greeting and the brief (the same composed or written brief Classic shows), then the date.
- **12-column grid of glass widgets:**
  - **Weather** (5 columns, tall):
    - The temperature set large, the condition, and the feels-like, humidity and wind line.
    - The next hours as a curve with four labelled points.
    - Its background is a sky tint chosen from the condition and day or night. There are no stock photos.
    - It uses the same `WeatherCard` loading, with a `variant="glass"` look.
  - **Portfolio** (4 columns): the total and today's change. Hidden when no broker is linked (`state: 'off'`).
  - **Activity** (3 columns): two rings, steps against the goal and routines done today against routines due, with the step count under them.
  - **Rest of today** (4 columns): today's remaining routines with their times. Hidden when none are left.
  - **Market read** (3 columns): the news digest's market summary and its sector lines.
  - **Top story** (7 columns): the first news article with its photo, headline and source.
  - **Needs you** (5 columns): heads-ups and important mail, the existing components inside one glass panel.
- **Kept below the grid:** the routine check (when one can be answered), the Gmail notice, the setup checklist and the privacy line.

## Data change (one)

- **Hourly temperatures.** The weather provider asks Open-Meteo for `temperature_2m` hourly as well as the rain chance.
- It returns the next 12 hours as `hours: Array<{ hour: string; temperature: number }>` on `Weather` and `BriefWeather`.
- Classic ignores the field.

## Not in this round

- **A 30-day portfolio chart.** Orbis keeps no history yet, so it needs a daily snapshot table and a cron job.
- **Market index sparklines.** The markets feed has no index series.
- **A Settings entry for the switch, any phone version, and the other mockups as views.**

## Testing

- **Unit tests:**
  - reading the saved view: missing, unknown or unreadable → Classic;
  - hourly temperatures parsed from an Open-Meteo reply, including gaps and fewer than 12 hours;
  - the curve's points from hours.
- **Owner check:**
  - on desktop, switch to Glass, reload (it stays), switch back;
  - on a phone width, no switch shows and Classic renders.
