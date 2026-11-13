# Deep Dive 3D: stylized 3D "What happens if…?" explainers, 9:16 (the flagship)

Real 3D, rendered in the browser with three.js: sculpted stylized people in warm sunlit sets, glowing x-ray cutaways,
camera journeys through blood vessels, shallow focus, a camera that never stops moving. Curious, shocking, satisfying.
Example: `example/` = **WHAT HAPPENS IF YOU HOLD YOUR BREATH?** (37 s, 11 shots). Style sheet: `style-sheet.png`
(regenerate it by opening `example/sheet.html` through `node tools/capture.mjs preview`).

## 1. The look (rules)
- **Three worlds, and every video moves between them:** (A) the real world: a person in a warm, sunlit set (kitchen),
  (B) the x-ray: the same body as cyan glass with a glowing skeleton and organs, (C) inside the body: macro shots
  (blood vessel, organs) in deep red with bloom. Real world → x-ray → inside → back out for the ending.
- **Warm low sun outside, cyan inside the body.** X-ray cyan `#4FD1E8` only for x-ray glass; red `#B8283A` for blood.
- **Shallow focus always:** focus on the subject, soft background (`aperture` 0.003-0.006 in the real world).
- **The camera always moves:** every shot pushes in, orbits or drifts (lerp the camera between two points over the shot).
- **No gore.** Injury or danger is shown as x-ray, glow, red alarm colour or a warning sign, never wounds.
- People: one sculpted body, many looks (`new Human({ skin, shirt, pants, shoes, hair, iris })`). Faces are calm and
  readable; avoid hand close-ups (hands are simple mittens).
- Captions: sentence case, 1-3 words, white with a dark outline, one yellow word (`src/core/captions.js`, y 1480).
  Labels: small dark pills with a leader line (`label()`), counters/facts as pills (`pill()`), `warning()` for danger.

## 2. Format
- 1080x1920, 24 fps (cinematic, and faster to render), 30-45 s. Narration `am_michael` x1.0, conversational.
- One line = one shot (cut just before the line: `cut(i)`), and a long line can hold a second shot starting on a word
  (`Wd('blood', 2)`), e.g. x-ray lungs → cut on "blood" → inside the vessel.
- Music: `"tension"` (low drone + slow pulse) for body/danger topics, `"bed"` for light ones.
