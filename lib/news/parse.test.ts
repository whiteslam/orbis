import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mergeArticles, parseNewsAnalysis, parseNewsData, parsePortfolioNews } from './parse.ts';
import type { NewsArticle } from './types.ts';

const raw = (results: unknown[]) => ({ status: 'success', totalResults: results.length, results });
const item = (over: Record<string, unknown> = {}) => ({
  article_id: 'a1',
  title: 'IT exporters rally on US deal flow',
  link: 'https://example.com/it',
  description: '<p>Large deals lift Indian IT.</p>',
  pubDate: '2026-10-02 06:30:00',
  source_name: 'Example Times',
  ...over,
});

test('NewsData articles keep only what a headline needs, with markup stripped', () => {
  const [article] = parseNewsData(raw([item()]), 'india');
  assert.deepEqual(article, {
    id: 'a1',
    title: 'IT exporters rally on US deal flow',
    description: 'Large deals lift Indian IT.',
    url: 'https://example.com/it',
    source: 'Example Times',
    publishedAt: '2026-10-02T06:30:00.000Z',
    desk: 'india',
  });
});

test('half-formed articles and error replies are dropped, not shown', () => {
  assert.equal(parseNewsData(raw([item({ link: 'javascript:alert(1)' }), item({ title: '' }), null]), 'world').length, 0);
  assert.deepEqual(parseNewsData({ status: 'error', results: { message: 'bad key' } }, 'world'), []);
  assert.deepEqual(parseNewsData(null, 'world'), []);
});

const article = (id: string, title: string, publishedAt = '2026-10-02T06:00:00.000Z'): NewsArticle =>
  ({ id, title, description: '', url: `https://example.com/${id}`, source: 'S', publishedAt, desk: 'world' });

test('the same story from two desks is counted once, newest first', () => {
  const merged = mergeArticles(
    [article('a', 'Oil jumps as Gulf tension rises', '2026-10-02T05:00:00.000Z')],
    [article('b', 'Oil jumps as Gulf tension rises!', '2026-10-02T04:00:00.000Z'), article('c', 'RBI holds rates', '2026-10-02T07:00:00.000Z')],
  );
  assert.deepEqual(merged.map((entry) => entry.id), ['c', 'a']);
});

const batch = [article('a', 'Oil jumps'), article('b', 'RBI holds rates'), article('c', 'IT deals')];

test('an analysis can only cite articles in the batch, and is cleaned to house style', () => {
  const analysis = parseNewsAnalysis(JSON.stringify({
    headlines: [{ id: 'a', line: 'Fuel costs may rise — watch airlines.' }, { id: 'zz', line: 'Invented.' }, { id: 'b', line: 'Loans stay where they are.' }, { id: 'a', line: 'Twice.' }],
    market: { summary: 'Energy up, airlines under pressure.', sectors: [{ sector: 'Oil & gas', outlook: 'up', why: 'Higher crude.' }, { sector: 'Crypto', outlook: 'moon', why: 'No.' }] },
  }), batch);
  assert.ok(analysis);
  assert.deepEqual(analysis.headlines.map((entry) => entry.articleId), ['a', 'b']);
  assert.equal(analysis.headlines[0].line, 'Fuel costs may rise, watch airlines.');
  assert.deepEqual(analysis.market.sectors.map((entry) => entry.sector), ['Oil & gas']);
});

test('a reply that is not JSON, or too thin to show, is refused', () => {
  assert.equal(parseNewsAnalysis('not json', batch), null);
  assert.equal(parseNewsAnalysis(JSON.stringify({ headlines: [{ id: 'a', line: 'Only one.' }], market: { summary: 'x', sectors: [] } }), batch), null);
});

test('portfolio impacts can only name holdings the person has', () => {
  const read = parsePortfolioNews(JSON.stringify({
    summary: 'IT may help, oil may hurt.',
    impacts: [{ holding: 'infy', outlook: 'up', why: 'Deal flow.' }, { holding: 'TSLA', outlook: 'down', why: 'Not held.' }],
  }), ['INFY', 'FD']);
  assert.deepEqual(read, { summary: 'IT may help, oil may hurt.', impacts: [{ holding: 'INFY', outlook: 'up', why: 'Deal flow.' }] });
  assert.equal(parsePortfolioNews('{}', ['INFY']), null);
});
