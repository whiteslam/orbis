# Cozy Tales: 2D storybook bedtime shorts with baby animals, 9:16

Warm, cute, gently funny. Original short stories (40-60 s) starring round baby animals with big shiny eyes, in
picture-book scenes (night forest, moon, fireflies, sunrise). For a general audience: cozy for kids, with a wink adults
enjoy. Example: `example/` = **PIP, THE OWL WHO WAS SCARED OF THE DARK** (43.5 s, 17 shots). Style sheet: `style-sheet.png`.

## 1. The look
- **Flat pastel shapes**, one darker shade + one highlight per shape. Sky may be a soft vertical gradient. Soft radial
  glow ONLY on lights (moon, sun, fireflies, stars, glowing numbers). No hard ink outlines on characters.
- **Palette** (`src/core/cozy.js` `P`): night sky `#232858→#4E4789`, dawn `#F49FB6→#FFD3A5`, day `#8FD3F4→#FFE9B8`,
  moon `#FFF3C4`, glow `#FFE89A`, owl `#C9A27E`, belly `#F3E3CC`, blanket `#8FB8E8` + white dots, bark `#7A5236`,
  night leaves `#33507A`, caption outline `#4A3426`, caption keyword peach `#FFB48A`.
- Characters: round body, big eyes with two white highlights, blush cheeks, tiny beak/nose. They act every shot
  (blink, look, tremble, yawn, hug). No scary content, no peril that isn't resolved warmly.

## 2. Format
- 1080x1920, 30 fps, 40-60 s. `script.json`: voice `af_heart` x0.95 (warm storyteller), lead 0.5, outro 1.6, gap 0.34
  (0.45-0.5 after a beat), `"music": "lullaby"` (procedural music-box waltz in `tools/mix.py`).
- **Story shape:** who + their problem (hook) → the joke/irony (adults smile) → the sad beat → a loving helper →
  a small magic moment → wonder (the world turns out beautiful) → resolution → a callback last line that loops to the start.
- One line = one cut (2-4 s). Shots **dissolve** (0.35 s, `main.js`; `fade: false` on a shot for a hard cut), the camera
  punch is gentle (4%) and every shot drifts (`zoom`, default 0.05).
- Captions: same `caps` syntax as Inside Out (`A BABY *OWL | ONE BIG *PROBLEM`), 132 px, white + brown outline, peach keyword.

## 3. Engine map
