import { describe, expect, it } from 'vitest';
import { buildDetails, cleanDetails, defaultPreset, DESCRIPTION_MAX, TAGS_MAX, tagsLength, TITLE_MAX } from './details';

const preset = defaultPreset('night-file');
const delivery = (over: Partial<{ title: string; caption: string; hashtags: string[] }> = {}) => ({
  title: 'A title',
  caption: 'Cap',
  hashtags: ['#a'],
  ...over,
});

describe('buildDetails', () => {
  it('trims the title to 100 code points and strips < and >', () => {
    const details = buildDetails(delivery({ title: '<b>' + '😀'.repeat(120) }), preset);
    expect([...details.title].length).toBe(TITLE_MAX);
    expect(details.title).not.toMatch(/[<>]/);
  });

  it('strips < and > from the description', () => {
    const details = buildDetails(delivery({ caption: 'a <script> b' }), preset);
    expect(details.description).not.toMatch(/[<>]/);
  });

  it('#shorts is appended once', () => {
    expect(buildDetails(delivery({ hashtags: ['#ai'] }), preset).description.endsWith('#ai #shorts')).toBe(true);
    const again = buildDetails(delivery({ caption: 'Cap', hashtags: ['#Shorts'] }), preset).description;
    expect(again).toBe('Cap\n\n#Shorts');
  });

  it('description is caption, blank line, hashtags', () => {
    expect(buildDetails(delivery({ caption: 'Cap', hashtags: ['#a', '#b'] }), preset).description).toBe('Cap\n\n#a #b #shorts');
  });

  it('has no leading blank lines when the caption is empty', () => {
    expect(buildDetails(delivery({ caption: '', hashtags: [] }), preset).description).toBe('#shorts');
  });

  it('keeps the description within 5000 code points and keeps the hashtags', () => {
    const details = buildDetails(delivery({ caption: 'x'.repeat(6000), hashtags: ['#a'] }), preset);
    expect([...details.description].length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(details.description.endsWith('#a #shorts')).toBe(true);
  });

  it('tags merge hashtags without # and preset tags, de-duplicated case-insensitively, within 500', () => {
    const merged = buildDetails(delivery({ hashtags: ['#AI', '#ai', '#Space'] }), { ...preset, tags: ['ai', 'Stories'] });
    expect(merged.tags).toEqual(['AI', 'Space', 'Stories']);

    const many = Array.from({ length: 60 }, (_, i) => `#tag${String(i).padStart(2, '0')}${'x'.repeat(20)}`);
    const long = buildDetails(delivery({ hashtags: many }), preset);
    expect(tagsLength(long.tags)).toBeLessThanOrEqual(TAGS_MAX);
    expect(long.tags.length).toBeLessThanOrEqual(30);
    expect(long.tags[0]).toBe(`tag00${'x'.repeat(20)}`);
    expect(long.tags).toEqual(many.map((tag) => tag.slice(1)).slice(0, long.tags.length));
  });

  it('carries the preset privacy, category and kids flag', () => {
    const details = buildDetails(delivery(), { ...preset, privacy: 'unlisted', categoryId: '27', madeForKids: true });
    expect(details).toMatchObject({ privacy: 'unlisted', categoryId: '27', madeForKids: true });
  });
});

describe('tagsLength', () => {
  it('tagsLength counts commas between tags and quotes around tags with spaces', () => {
    expect(tagsLength(['a b', 'c'])).toBe(7);
    expect(tagsLength([])).toBe(0);
    expect(tagsLength(['abc'])).toBe(3);
  });
});

describe('defaultPreset', () => {
  it('defaultPreset maps the seven styles and falls back to 24', () => {
    const expected: Record<string, string> = {
      'tall-tale': '23',
      'cozy-tales': '1',
      'deep-dive': '27',
      'inside-out': '27',
      'paper-atlas': '27',
      'night-file': '24',
      'stick-story': '24',
      unknown: '24',
    };
    for (const [style, category] of Object.entries(expected)) {
      expect(defaultPreset(style)).toMatchObject({ style, categoryId: category, privacy: 'public', madeForKids: style === 'cozy-tales' });
    }
  });

  it('marks the children’s bedtime style as made for kids, as YouTube requires', () => {
    expect(defaultPreset('cozy-tales').madeForKids).toBe(true);
    expect(defaultPreset('deep-dive').madeForKids).toBe(false);
  });
});

describe('cleanDetails', () => {
  const good = { title: '  Hello <world>  ', description: ' Desc ', tags: [' a ', 'A', 'b,c'], categoryId: '24', privacy: 'unlisted', madeForKids: true };

  it('trims and normalises a good input', () => {
    expect(cleanDetails(good)).toEqual({ title: 'Hello world', description: 'Desc', tags: ['a', 'bc'], categoryId: '24', privacy: 'unlisted', madeForKids: true });
  });

  it('refuses an empty title, a bad privacy or a non-numeric category, and trims the rest', () => {
    expect(cleanDetails({ ...good, title: '   ' })).toBeNull();
    expect(cleanDetails({ ...good, title: '<>' })).toBeNull();
    expect(cleanDetails({ ...good, privacy: 'secret' })).toBeNull();
    expect(cleanDetails({ ...good, categoryId: 'abc' })).toBeNull();
    expect(cleanDetails({ ...good, categoryId: 24 })).toBeNull();
    expect(cleanDetails(null)).toBeNull();
    expect(cleanDetails('x')).toBeNull();
    expect(cleanDetails([])).toBeNull();
  });

  it('cuts the title to 100 code points and the description to 5000', () => {
    const cut = cleanDetails({ ...good, title: '😀'.repeat(150), description: 'y'.repeat(6000) });
    expect([...(cut?.title ?? '')].length).toBe(100);
    expect([...(cut?.description ?? '')].length).toBe(5000);
  });

  it('caps tags at 30 and 500 joined, and ignores non-strings', () => {
    const tags = [...Array.from({ length: 80 }, (_, i) => `tag${i}${'z'.repeat(15)}`), 7, null];
    const cut = cleanDetails({ ...good, tags });
    expect(cut).not.toBeNull();
    expect(cut!.tags.length).toBeLessThanOrEqual(30);
    expect(tagsLength(cut!.tags)).toBeLessThanOrEqual(500);
  });

  it('treats a missing tags list and a non-boolean kids flag as empty and false', () => {
    const cut = cleanDetails({ title: 'T', categoryId: '24', privacy: 'public' });
    expect(cut).toEqual({ title: 'T', description: '', tags: [], categoryId: '24', privacy: 'public', madeForKids: false });
  });
});
