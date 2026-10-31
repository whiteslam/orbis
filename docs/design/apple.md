# Orbis, the Apple way

The design rules for every screen in Orbis. They come from two sources, and a
change that breaks one of them needs a reason written next to it:

- Apple's Human Interface Guidelines, through the apple-design skill
  (github.com/dickwu/apple-design-skill): layout, type, colour, materials,
  components.
- Emil Kowalski's design-engineering skills (github.com/emilkowalski/skills),
  `emil-design-eng` and `apple-design`: motion, easing, press feedback, and
  when not to animate.

The test for any screen: put it next to Apple's Health, Wallet or Fitness app.
If it looks like it came from a different company, it is not done.

## Principles that decide arguments

1. **Content first, chrome second.** Glass (blur and translucency) is for the
   floating layer only: the tab bar, sheets, the Ask button, sticky headers.
   Never behind body text, never on cards in a scrolling list.
2. **One tint.** Orbis teal is the app's tint, the way Fitness uses green. It
   marks the primary action, the selected tab, links and selection, and
   nothing else. Status uses the system colours (red, orange, green), never
   the tint.
3. **Familiar parts.** Tab bar, large title, inset grouped list, segmented
   control, switch, capsule button, sheet. A restyled control keeps Apple's
   size, placement and behaviour.
4. **Grouping, not decoration.** No gradients on controls, no glow, no
   wallpaper. Hierarchy comes from the grouped background, type weight and
   spacing.
5. **Motion is feedback, not ornament.** If people see it many times a day, it
   doesn't animate.

## Colour

Semantic tokens, Apple's values. Light is Apple's grouped light, dark is
Apple's grouped dark (true black background, #1C1C1E cells).
Contrast figures are for text on the cell colour.

| Token | Role | Light | Dark |
| --- | --- | --- | --- |
| `--sys-bg` | grouped background (the page) | `#F2F2F7` | `#000000` |
| `--sys-surface` | cell / card | `#FFFFFF` | `#1C1C1E` |
| `--sys-surface-2` | cell on a cell, input fill | `#F2F2F7` | `#2C2C2E` |
| `--sys-surface-3` | third level, pressed cell | `#E5E5EA` | `#3A3A3C` |
| `--sys-label` | primary text | `#000000` (21:1) | `#FFFFFF` (17:1) |
| `--sys-secondary` | secondary text | `#6C6C70` (5.2:1) | `#98989F` (5.9:1) |
| `--sys-tertiary` | icons, large text only | `#8E8E93` | `#8D8D93` |
| `--sys-separator` | hairlines | `rgba(60,60,67,.29)` | `rgba(84,84,88,.65)` |
| `--sys-fill` | control track, grey button | `rgba(120,120,128,.12)` | `rgba(118,118,128,.24)` |
| `--tint` | the Orbis tint | `#087A65` (5.3:1) | `#42CCA8` (8.5:1) |
| `--on-tint` | text on a tint fill | `#FFFFFF` (5.3:1) | `#00231B` (8.4:1) |
| `--sys-red` | destructive, errors | `#D70015` (5.4:1) | `#FF6961` (6.0:1) |
| `--sys-green` | success, on switches | `#1E7D36` | `#30D158` |
| `--sys-amber` | warnings | `#C93400` (5.3:1) | `#FF9F0A` (8.3:1) |
| `--sys-blue` | links outside the tint, info | `#0040DD` (7.6:1) | `#409CFF` (6.0:1) |

Light-mode system colours use Apple's accessible variants so text in them
passes 4.5:1. Switch tracks use Apple green (`#34C759` / `#30D158`), as on
iOS.

Appearance follows the system. The light/dark button stays as an override,
but a first visit gets whatever the device is set to.

## Type

The system font: SF Pro on Apple devices, Segoe UI Variable on Windows,
Roboto on Android. No web font in the app.

```
-apple-system, BlinkMacSystemFont, system-ui, "Segoe UI Variable Text", "Segoe UI", Roboto, sans-serif
```

Apple's iOS text styles. Sizes in px; tracking is tighter as text grows and
zero at body size and below.

| Token | Use | Size / line | Weight | Tracking |
| --- | --- | --- | --- | --- |
| `--t-large-title` | screen title | 34 / 41 | 700 | -0.02em |
| `--t-title-1` | hero figures | 28 / 34 | 700 | -0.02em |
| `--t-title-2` | section heads on wide screens | 22 / 28 | 700 | -0.01em |
| `--t-title-3` | card titles | 20 / 25 | 600 | -0.01em |
| `--t-headline` | row titles, buttons | 17 / 22 | 600 | 0 |
| `--t-body` | body, list rows | 17 / 22 | 400 | 0 |
| `--t-callout` | dense body | 16 / 21 | 400 | 0 |
| `--t-subhead` | secondary row text | 15 / 20 | 400 | 0 |
| `--t-footnote` | section footers, captions | 13 / 18 | 400 | 0 |
| `--t-caption` | timestamps, meta | 12 / 16 | 400 | 0 |

Section headers in grouped lists are 13px regular, secondary label, sentence
case. No uppercase eyebrows, no letter-spaced labels. Minimum text size 11px.
Figures use `font-variant-numeric: tabular-nums`.

## Shape and space

- Cards and grouped sections: 22px corner radius, 16px inner padding, 16px
  side margins on phones, `--sys-surface` on `--sys-bg`, no border, no shadow.
- Rows: 44px minimum height (Apple's touch target), separators inset to the
  text, hairline `--sys-separator`.
- Buttons are capsules. 50px tall for the one primary action on a screen,
  34-44px elsewhere.
- Spacing steps: 4, 8, 12, 16, 20, 24, 32. Section gap 32px on phones.
- Shadows only on floating things (tab bar, sheets, popovers), never on cards.

## Components

| Part | Apple pattern | Notes |
| --- | --- | --- |
| Tab bar | iOS 26 floating glass capsule | Selected tab: tint icon and label on a grey fill. No gradient. |
| Screen header | Large title, 34px bold, left-aligned | The date sits above it in 15px secondary. |
| Primary button | Tinted capsule | `--tint` fill, `--on-tint` text, 17px semibold. |
| Secondary button | Grey capsule | `--sys-fill` fill, `--tint` text. |
| Plain button / link | Tint text | No underline. |
| Destructive | Red text, or red fill only in a confirm dialog | |
| Segmented control | Grey track, raised thumb | Track `--sys-fill`, thumb `--sys-surface` in light, `#636366` in dark, 32px tall. |
| Chips / filters | Grey capsule; selected = tint fill | 32px tall, 15px text. |
| Switch | iOS switch, green track | |
| Text field | Filled, no border | `--sys-surface-2` fill, 10px radius, 44px tall, 17px text (no zoom on iOS). |
| Sheet | Rises from the bottom, grabber, 10px dimming | Drawer curve (see Motion). Close at top right. |
| Popover / menu | Scales from its trigger | `transform-origin` at the trigger. |

## Materials

```
--glass-chrome-bg: light rgba(255,255,255,.72), dark rgba(30,30,32,.72)
--glass-blur:      blur(24px) saturate(180%)
```

A glass surface has a hairline top edge (light catching it) and a soft shadow.
Reduce Transparency swaps it for the solid cell colour. Increased Contrast
adds a visible border.

## Motion

Fluid and physical, the way Apple's "Designing Fluid Interfaces" describes
it, with Emil Kowalski's rules for when not to animate.

**Springs.** Things move on springs described the way Apple does: a damping
ratio (1 = no overshoot) and a response in seconds. `lib/motion/spring.ts`
holds them and turns each into a CSS `linear()` easing; the tokens in
`app/styles/brand.css` are its output, and a unit test keeps them in step.

| Token (+ `-dur`) | Spring | Use |
| --- | --- | --- |
| `--spring` | damping 1, response .4 | sheets, pages, most movement |
| `--spring-snappy` | damping 1, response .28 | thumbs, knobs, menus, small state |
| `--spring-bouncy` | damping .8, response .4 | only after a flick or drag let go |

`transition: transform var(--spring-dur) var(--spring)`. The cubic-bezier
tokens (`--ease-out`, `--ease-in-out`, `--ease-drawer`) remain for the
moment of a press and for hover.

**What moves, and how**

| What | Motion |
| --- | --- |
| Press | Every button scales to .97 the instant it's pressed (100ms ease-out), springs back on release. Rows .985, tab bar and Ask button .9. Uses the `scale` property so it composes with any transform. |
| Selection | The selected background of segmented controls, the tab bar and the desktop rail glides to the new item on `--spring-snappy` (motion runtime). |
| Switch | The knob springs across and stretches while held, as on iOS. |
| Page opened from a tab | Pushes in from the right on `--spring`. |
| Settings (phone) | Rises from the foot; sinks back when closed with a tap; can be dragged down by its header. |
| Ask Orbis (phone) | Grows out of its button and shrinks back into it; can be dragged down by its header. |
| Desktop dialog / docked panel | The dialog grows in place (.96); the docked panel slides in from its edge. |
| Menus, popovers | Scale from their trigger (.96) on `--spring-snappy`. |
| Things that appear because of a tap | Opacity plus an 8px rise on `--spring`. |

**Gestures** (`components/motion/motion-runtime.tsx`): a drag tracks the
finger 1:1 after 10px, resists past the edge (rubber-banding), and on
release the finger's velocity is handed to the spring; whether the sheet
closes is decided by where the flick would come to rest (Apple's momentum
projection), not where the finger let go.

**Rules**

- Never animate what people do many times a day: the content of a tab swaps
  instantly (only the tab bar's selection glides). Keyboard actions never
  animate: Escape or Enter closes a sheet at once.
- Enter and exit the same way. Exits are quicker than entrances.
- Interruptible state uses transitions, not keyframes, so a second tap
  reverses from wherever it is.
- Only `transform`, `scale` and `opacity` (and `filter` under 20px). No
  `transition: all`. Never from `scale(0)`; never ease-in.
- Reduce Motion: nothing moves; sheets fade.
- One signature moment: the Ask Orbis mark animates its own phases.
