# Inside Out: flat 2D "What happens if…?" shorts, 9:16

Curious, slightly shocking, satisfying. A simple flat hero, x-ray cutaways into the body, organs and props as clean
vector shapes, bold 1-3 word captions with one yellow word, and a cut every 1-3 seconds with the camera always moving.
Example to study and copy: `example/` = **WHAT IF YOU SWALLOW GUM?** (30 s, 11 shots). Style sheet: `style-sheet.png`.

## 1. The look (rules from the sheet: do not break them)
- **Flat shapes only.** No gradients, textures or realistic lighting. Depth comes from flat darker/lighter tones of the
  same colour (shirt shade, organ highlight), never from blur or glow.
- **Palette:** skin `#E8B89A` · organ pink `#E57A8A` · danger red `#D62839` · x-ray cyan `#4FD1E8` · highlight yellow
  `#FFD43B` · background `#F4F1EA`, plus ink `#1A1A1E` and the derived shades in `lib.js` `C`.
- **X-ray cyan is only for inside-the-body views** (skeleton, x-ray film background, gut glow). **Red marks danger or the
  problem** (X, warning, blockage ring, stopwatch hand). **Yellow is the one keyword per caption**, impact bursts and acid.
- **One visual mode per shot.** X-ray means the whole body is x-ray (arms, neck, legs), only the head stays normal.
- Characters are minimal and friendly: round head, dot eyes with a highlight, simple tee and pants, expressive brows and
  mouth. They react on the beat (gulp, shock, smirk, finger wag) and may look at the camera on the twist ending.
- Mood: curious, slightly shocking, satisfying. Accurate science, no gore, no injury on screen.

## 2. Format
- **1080x1920, 30 fps, 25-45 s.** Lead silence 0.45 s, outro 0.9 s (they're in `script.json`).
- **Story shape:** hook question (hero + the thing) → x-ray: where it goes → close-up of what happens → the key fact →
  myth busted (red X) → what really happens → time passes → **twist: "but if you…"** (danger, red) → the hero's punchy
  last line to camera (loops back to the hook).
- **One line = one shot = one cut**, and a sentence usually spans 2-3 lines (`"It slides down your throat and lands
  right in your stomach,"` / `"where strong acid gets to work on it."`). The voice speaks each sentence in one pass, so
