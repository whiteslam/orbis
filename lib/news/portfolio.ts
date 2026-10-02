import 'server-only';

import { createHash } from 'node:crypto';
import { AI_OFF_MESSAGE } from '@/lib/ai/consent';
import { aiBlocked } from '@/lib/ai/gate';
import { claimAiCredit } from '@/lib/ai/quota';
import { getLatestAiResult, saveAiResult } from '@/lib/ai/results';
import { routeJson } from '@/lib/ai/router';
import { loadOwnInvestments } from '@/lib/finance/repository';
import { analysePortfolio } from '@/lib/invest/analysis';
import { loadLivePortfolio } from '@/lib/invest/live';
import { getNewsDigest } from '@/lib/news/digest';
import { parsePortfolioNews, PORTFOLIO_NEWS_SYSTEM } from '@/lib/news/parse';
import type { PortfolioNews, PortfolioNewsResult } from '@/lib/news/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

// Written again only when the news batch or the holdings change, which is a
// few times a day at most. Its own counter, so it never eats a request the
// person wanted to spend on portfolio suggestions or a question.
const DAILY_LIMIT = 4;
const MAX_HOLDINGS = 30;

type Holding = { name: string; kind: string; sharePercent: number | null };

/**
 * What today's news may mean for what you hold: the shared market reading of
 * the news, set against your broker holdings and the FDs, SIPs and the rest you
 * recorded yourself. Personal, so only a model that will not train on it sees it.
 */
export async function loadPortfolioNews(userId: string, email: string | null): Promise<PortfolioNewsResult> {
  const blocked = await aiBlocked(userId, 'personal');
  if (blocked === 'off') return { state: 'off', message: AI_OFF_MESSAGE };
  if (blocked) return { state: 'error', message: 'No AI provider that can hold your holdings is available right now.' };

  const [news, live, own] = await Promise.all([
    getNewsDigest(userId),
    loadLivePortfolio(userId, email),
    createClient().then((supabase) => loadOwnInvestments(supabase, userId)),
  ]);
  if (news.state !== 'ok' || !news.analysis) return { state: 'error', message: 'Today’s news reading isn’t ready yet. Try again shortly.' };

  const analysis = analysePortfolio(live.brokers);
  const round = (value: number) => Math.round(value * 10) / 10;
  const holdings: Holding[] = [
    ...analysis.positions.slice(0, MAX_HOLDINGS).map((position) => ({
      name: position.name,
      kind: position.assetClass,
      sharePercent: analysis.total > 0 ? round((position.value / analysis.total) * 100) : null,
    })),
    ...own.categories.map((entry) => ({ name: entry.category, kind: 'Recorded by you', sharePercent: null })),
  ];
  if (!holdings.length) return { state: 'empty' };

  const fingerprint = createHash('sha256')
    .update(JSON.stringify([news.batch, holdings.map((holding) => holding.name).sort()]))
    .digest('hex')
    .slice(0, 32);
  const saved = await getLatestAiResult<PortfolioNews, { fingerprint?: string }>(userId, 'portfolio_news');
  if (saved?.context?.fingerprint === fingerprint && saved.result) {
    return { state: 'ok', result: saved.result, generatedAt: saved.createdAt, fresh: false };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { state: 'error', message: 'AI usage limits are not available right now.' };
  }
  const credit = await claimAiCredit((fn, args) => admin.rpc(fn, args), userId, 'portfolio_news', DAILY_LIMIT);
  if (credit === 'error') return { state: 'error', message: 'This can’t be written right now. Try again later.' };
  if (credit === 'limit') {
    return saved?.result
      ? { state: 'ok', result: saved.result, generatedAt: saved.createdAt, fresh: false }
      : { state: 'error', message: 'Today’s AI requests for this are used up. It will update again tomorrow.' };
  }

  const names = holdings.map((holding) => holding.name);
  const result = await routeJson({
    userId,
    feature: 'portfolio_news',
    sensitivity: 'personal',
    system: PORTFOLIO_NEWS_SYSTEM,
    user: `News reading:\n${JSON.stringify(news.analysis.market)}\n\nHoldings:\n${JSON.stringify(holdings)}`,
    maxTokens: 1_000,
    timeoutMs: 20_000,
    temperature: 0.3,
    accept: (text) => parsePortfolioNews(text, names) !== null,
  });
  const read = result ? parsePortfolioNews(result.text, names) : null;
  if (!read || !result) return { state: 'error', message: 'No AI provider answered. Try again shortly.' };

  const stamp = await saveAiResult({
    userId,
    feature: 'portfolio_news',
    result: read,
    model: `${result.providerId}/${result.modelId}`,
    title: 'News and your holdings',
    context: { fingerprint, batch: news.batch },
  });
  return { state: 'ok', result: read, generatedAt: stamp?.createdAt ?? new Date().toISOString(), fresh: true };
}
