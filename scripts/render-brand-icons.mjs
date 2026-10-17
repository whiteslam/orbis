// Renders every raster Orbis icon from the brand ring, so they never drift from
// the CSS mark: a conic-gradient ring (#5BB4E8 → #42CCA8 → #3DC87A) with a hole
// at 45% of its diameter, on #0E0E10. Run with: node scripts/render-brand-icons.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

// `shape`: 'rounded' is a rounded square on a transparent corner (browser tabs,
// the manifest's "any" icons); 'bleed' fills the canvas edge to edge (the OS applies
// its own mask: maskable icons and iOS home-screen icons). `ring` is the ring's
// share of the canvas; maskable icons keep the ring inside the 80% safe zone.
const targets = [
  { file: 'public/icons/icon-192.png', size: 192, shape: 'rounded', ring: 0.62 },
  { file: 'public/icons/icon-512.png', size: 512, shape: 'rounded', ring: 0.62 },
  { file: 'public/icons/icon-maskable-192.png', size: 192, shape: 'bleed', ring: 0.5 },
  { file: 'public/icons/icon-maskable-512.png', size: 512, shape: 'bleed', ring: 0.5 },
  { file: 'public/apple-touch-icon.png', size: 180, shape: 'bleed', ring: 0.6 },
  { file: 'app/apple-icon.png', size: 180, shape: 'bleed', ring: 0.6 },
  { file: 'app/icon.png', size: 96, shape: 'rounded', ring: 0.64 },
  { file: 'public/brand/orbis-mark.png', size: 256, shape: 'rounded', ring: 0.64 },
];
const favicons = [16, 32, 48];

const html = ({ size, shape, ring }) => `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;background:transparent}
  .tile{width:${size}px;height:${size}px;background:#0e0e10;border-radius:${shape === 'rounded' ? '22%' : '0'};display:grid;place-items:center}
  .ring{width:${ring * 100}%;aspect-ratio:1;border-radius:50%;position:relative;background:conic-gradient(from 200deg,#5bb4e8,#42cca8,#3dc87a,#5bb4e8)}
  .hole{position:absolute;top:50%;left:50%;width:45%;height:45%;transform:translate(-50%,-50%);border-radius:50%;background:#0e0e10}
</style><div class="tile"><div class="ring"><div class="hole"></div></div></div>`;

const browser = await chromium.launch();
const render = async (spec) => {
  const page = await browser.newPage({ viewport: { width: spec.size, height: spec.size } });
  await page.setContent(html(spec));
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: spec.size, height: spec.size } });
  await page.close();
  return png;
};

// Each icon gets its own page, so they can all render at once.
await Promise.all(targets.map(async (target) => {
  const out = resolve(root, target.file);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, await render(target));
  console.log('wrote', target.file);
}));

// favicon.ico: an ICO container holding one PNG per size.
const images = await Promise.all(
  favicons.map(async (size) => ({ size, png: await render({ size, shape: 'rounded', ring: 0.66 }) })),
);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = 6 + images.length * 16;
const entries = images.map(({ size, png }) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size, 0);
  entry.writeUInt8(size, 1);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += png.length;
  return entry;
});
writeFileSync(resolve(root, 'app/favicon.ico'), Buffer.concat([header, ...entries, ...images.map((i) => i.png)]));
console.log('wrote app/favicon.ico');

await browser.close();
