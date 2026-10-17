import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Reads the palette straight from brand.css so a token edit that drops a text
// colour below WCAG AA fails here, not in front of a user.
const css = readFileSync(resolve(__dirname, '../../app/styles/brand.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
  const tokens: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/(?<![\w-])(--[\w-]+):([^;]+);/g)) tokens[name] = value.trim();
  return tokens;
}

const base = block(':root');
const dark = { ...base, ...block(':root:not([data-theme="light"])') };
const light = { ...base, ...block(':root[data-theme="light"]') };

function resolveColor(tokens: Record<string, string>, value: string): string {
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  return ref ? resolveColor(tokens, tokens[ref[1]]) : value;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const hi = Math.max(luminance(a), luminance(b));
  const lo = Math.min(luminance(a), luminance(b));
  return (hi + 0.05) / (lo + 0.05);
}

const pair = (tokens: Record<string, string>, fg: string, bg: string) =>
  ratio(resolveColor(tokens, tokens[fg]), resolveColor(tokens, tokens[bg]));

describe('brand text contrast (WCAG AA, 4.5:1 for body text)', () => {
  const darkText = ['--sys-label', '--sys-secondary', '--fd-soft', '--fd-faint', '--sys-blue', '--sys-green', '--sys-red', '--sys-amber', '--fd-accent'];
  const darkSurfaces = ['--sys-bg', '--sys-surface', '--sys-surface-2'];
  for (const fg of darkText) for (const bg of darkSurfaces) {
    it(`dark ${fg} on ${bg}`, () => expect(pair(dark, fg, bg)).toBeGreaterThanOrEqual(4.5));
  }

  it('dark ink on the teal, blue and red fills', () => {
    for (const fill of ['--brand-teal', '--brand-blue', '--brand-red']) {
      expect(pair(dark, '--brand-on-accent', fill)).toBeGreaterThanOrEqual(4.5);
    }
  });

  const lightText = ['--sys-label', '--sys-secondary', '--sys-blue', '--sys-green', '--sys-red', '--sys-amber'];
  const lightSurfaces = ['--sys-bg', '--sys-surface'];
  for (const fg of lightText) for (const bg of lightSurfaces) {
    it(`light ${fg} on ${bg}`, () => expect(pair(light, fg, bg)).toBeGreaterThanOrEqual(4.5));
  }

  it('light field text on the glass ground', () => {
    for (const fg of ['--fd-ink', '--fd-soft', '--fd-faint', '--fd-accent', '--fd-alert']) {
      expect(pair(light, fg, '--gl-ground')).toBeGreaterThanOrEqual(4.5);
    }
  });
});
