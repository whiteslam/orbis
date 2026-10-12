# Orbis brand prompt

Reference: https://claude.ai/artifact/S4TKVxBGQ3Mzzhqp1NZrrk#page-03174c151310 (Orbis Logo Family)

I'm building for Orbis, a personal intelligence app. Use these brand specifications for everything you design or build:

## Identity

- **App name:** Orbis
- **Tagline:** Your world, intelligently connected
- **Logo mark:** A ring using a conic-gradient from blue (`#5BB4E8`) through teal (`#42CCA8`) to green (`#3DC87A`), with an inner hole at ~45% of the outer diameter. Never use an SVG stroke — always a div with an inner hole div.

## Color palette (dark-first)

| Role | Value |
| --- | --- |
| Background | `#0E0E10` |
| Surface 1 | `#141416` |
| Surface 2 | `#1A1A1E` |
| Edge/border | `#242428` |
| Teal accent | `#42CCA8` |
| Blue accent | `#5BB4E8` |
| Green | `#3DC87A` |
| Red | `#F26B6B` |
| Gold | `#F0B429` |

Gradient (brand): `linear-gradient(135deg, #5BB4E8, #42CCA8)`

## Typography

Font: DM Sans (weights 300, 400, 500, 600) — load from Google Fonts

- **Display:** 28–32px / weight 600
- **Heading:** 18–20px / weight 600
- **Body:** 14–15px / weight 400
- **Label/caption:** 11–12px / weight 500, letter-spacing 0.5px, uppercase

## UI components

- **Phone frame:** 320px wide, border-radius 40px, background `#0A0A0C`, 1.5px border `#242428`
- **Cards:** background `#141416` or `#1A1A1E`, border-radius 16px, 1px border `#242428`
- **Pills/badges:** border-radius 20px, small padding, teal/blue/red/gold fills
- **Tab bar:** 5 tabs — Home, Health, Money, AI, Settings; active tab uses teal gradient
- **Bottom nav:** height 60px with 20px icon + 10px label

## App screens already designed (reference these for consistency)

- **Home Tab:** market tickers, weather/calendar, top story, health nudge, push notifications
- **Health Tab:** daily score ring, sleep stages bar, activity rings, vitals grid (HR, VO2, SpO2, temp)
- **Money Tab:** net worth hero, portfolio donut, spending budgets, market indices, AI insight card
- **AI Tab:** chat bubbles (user = gradient right, AI = dark card left), quick actions, morning digest, capability cards
- **Email Template:** dark hero header, score row, markets grid, CTA button, footer

## Brand assets already built

- Logo lockups (horizontal, stacked, icon-only, white, dark, monochrome)
- App icons (1024px, 512px, 192px, 64px with rounded corners)
- Type treatments (6 headline styles using the gradient)
- In-use mockups (browser tab, phone, email signature, social banner, nav bar, push notification)
- Loading animations (spinner, splash, pulse, progress bar, dots, arc sweep)

Apply all of the above automatically. Do not ask me to re-describe the brand — treat this as the single source of truth.
