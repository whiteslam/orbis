import { test, vi } from 'vitest';
import assert from 'node:assert/strict';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => null }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => null }));

const { readSettings } = await import('./repository');

test('settings written around the save action still read back within its caps', () => {
  const watchlist = Array.from({ length: 5_000 }, (_, index) => ({ ats: 'greenhouse', slug: `co${index}`, name: `Co ${index}` }));
  const synonyms = Array.from({ length: 5_000 }, () => Array.from({ length: 100 }, (_, index) => `word${index}`));
  const adzunaCountries = Array.from({ length: 500 }, () => 'gb');
  const settings = readSettings({ watchlist, synonyms, adzunaCountries });
  assert.equal(settings.watchlist.length, 50);
  assert.equal(settings.watchlist[0].slug, 'co0');
  assert.equal(settings.synonyms.length, 50);
  assert.ok(settings.synonyms.every((group) => group.length === 10));
  assert.equal(settings.adzunaCountries.length, 10);
});

test('lists within the caps read back unchanged', () => {
  const watchlist = [{ ats: 'lever', slug: 'acme', name: 'Acme' }];
  const settings = readSettings({ watchlist, synonyms: [['dev', 'engineer']], adzunaCountries: ['in', 'gb'] });
  assert.deepEqual(settings.watchlist, watchlist);
  assert.deepEqual(settings.synonyms, [['dev', 'engineer']]);
  assert.deepEqual(settings.adzunaCountries, ['in', 'gb']);
});
