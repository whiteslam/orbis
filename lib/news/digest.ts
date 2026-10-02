import 'server-only';

import { createHash } from 'node:crypto';
import { routeJson } from '@/lib/ai/router';
import { cached, consumeProviderCall, isFresh, readCache, writeCache } from '@/lib/providers/cache';
import { ProviderError, providerJson } from '@/lib/providers/core';
import { mergeArticles, NEWS_SYSTEM, newsUserPrompt, parseNewsAnalysis, parseNewsData } from '@/lib/news/parse';
import type { NewsAnalysis, NewsArticle, NewsDigest } from '@/lib/news/types';

// NewsData's free plan allows 200 credits a day. Two calls per refresh, one
// refresh every three hours for everyone at once, is 16 a day; the cap below
// is headroom against a burst of misses, not the budget itself.
const NEWSDATA_DAILY_LIMIT = 60;
const ARTICLES_TTL = 3 * 60 * 60;
// An analysis belongs to one batch of articles, which never changes, so it
// can be kept for as long as that batch could still be served.
const ANALYSIS_TTL = 24 * 60 * 60;
const NEWSDATA = 'https://newsdata.io/api/1/latest';

async function fetchDesk(apiKey: string, desk: NewsArticle['desk']) {
  if (!(await consumeProviderCall('newsdata', NEWSDATA_DAILY_LIMIT))) throw new ProviderError('newsdata', 'rate_limited');
  const url = new URL(NEWSDATA);
  url.searchParams.set('apikey', apiKey);
  url.searchParams.set('language', 'en');
  url.searchParams.set('removeduplicate', '1');
  if (desk === 'india') {
    url.searchParams.set('country', 'in');
    url.searchParams.set('category', 'business');
  } else {
    url.searchParams.set('category', 'world,technology,top');
    url.searchParams.set('prioritydomain', 'top');
  }
  return parseNewsData(await providerJson('newsdata', url.toString(), { timeoutMs: 10_000 }), desk);
}

/** Today's articles, shared by every user and refreshed every three hours. */
async function loadArticles(): Promise<{ articles: NewsArticle[]; fetchedAt: string } | 'not_configured' | 'unavailable'> {
  const apiKey = process.env.NEWSDATA_API_KEY?.trim();
  try {
    const fetched = await cached('newsdata', 'news:articles:v1', ARTICLES_TTL, async () => {
      if (!apiKey) throw new ProviderError('newsdata', 'not_configured');
      // One desk failing still leaves a card; both failing is an outage.
      const [india, world] = await Promise.allSettled([fetchDesk(apiKey, 'india'), fetchDesk(apiKey, 'world')]);
      const articles = mergeArticles(
        india.status === 'fulfilled' ? india.value : [],
        world.status === 'fulfilled' ? world.value : [],
      );
      if (!articles.length) throw india.status === 'rejected' ? india.reason : new ProviderError('newsdata', 'unavailable');
      return articles;
    });
    return { articles: fetched.data, fetchedAt: fetched.fetchedAt };
  } catch (error) {
    return error instanceof ProviderError && error.kind === 'not_configured' ? 'not_configured' : 'unavailable';
  }
}

export function batchOf(articles: NewsArticle[]) {
  return createHash('sha256').update(articles.map((article) => article.id).sort().join('|')).digest('hex').slice(0, 16);
}

/**
 * The reading of one batch. Written once and shared: the articles are public
 * and nothing about the person is sent, so it goes to the router as 'general'.
 * It is still written on behalf of someone who has turned AI on (the router
 * checks), and someone with AI off simply gets the headlines.
 */
async function analyse(userId: string, articles: NewsArticle[], batch: string): Promise<NewsAnalysis | null> {
  const key = `news:analysis:${batch}`;
  const row = (await readCache([key])).get(key);
  if (row && isFresh(row)) return row.response as NewsAnalysis;

  const result = await routeJson({
    userId,
    feature: 'news_digest',
    sensitivity: 'general',
    system: NEWS_SYSTEM,
    user: newsUserPrompt(articles),
    maxTokens: 1_400,
    timeoutMs: 20_000,
    temperature: 0.3,
    accept: (text) => parseNewsAnalysis(text, articles) !== null,
  });
  const analysis = result ? parseNewsAnalysis(result.text, articles) : null;
  if (analysis) await writeCache('newsdata', [{ key, response: analysis, ttlSeconds: ANALYSIS_TTL }]);
  return analysis;
}

export async function getNewsDigest(userId: string): Promise<NewsDigest> {
  const loaded = await loadArticles();
  if (loaded === 'not_configured' || loaded === 'unavailable') return { state: loaded };
  const batch = batchOf(loaded.articles);
  const analysis = await analyse(userId, loaded.articles, batch).catch(() => null);
  return { state: 'ok', fetchedAt: loaded.fetchedAt, articles: loaded.articles, analysis, batch };
}
