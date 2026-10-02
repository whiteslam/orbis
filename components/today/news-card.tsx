'use client';

import { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, LoaderCircle, Newspaper, Sparkles } from 'lucide-react';
import { openAsk } from '@/lib/ask/about';
import type { NewsArticle, NewsDigest, Outlook } from '@/lib/news/types';

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; digest: NewsDigest };

// The server refreshes the news every three hours; Home remounts on every tab
// switch, so the last answer is reused for a while rather than asked for again.
let lastDigest: { at: number; digest: NewsDigest } | null = null;
const CLIENT_TTL_MS = 15 * 60 * 1000;
const PLAIN_HEADLINES = 5;

const OUTLOOK: Record<Outlook, { icon: typeof ArrowUpRight; label: string }> = {
  up: { icon: ArrowUpRight, label: 'likely up' },
  down: { icon: ArrowDownRight, label: 'likely down' },
  mixed: { icon: ArrowRight, label: 'mixed' },
};

function ago(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${Math.max(minutes, 1)} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
}

function Headline({ article, line }: { article: NewsArticle; line?: string }) {
  const ask = () => openAsk(
    { kind: 'news', title: article.title, detail: [line, article.description, `Source: ${article.source}`].filter(Boolean).join(' '), url: article.url },
    'What does this mean, and could it affect my money or investments?',
  );
  return (
    <div className="fd-news-item">
      <a className="fd-news-row" href={article.url} target="_blank" rel="noopener noreferrer">
        <span className="fd-news-title">{article.title}</span>
        {line && <span className="fd-news-line">{line}</span>}
        <span className="fd-news-meta" suppressHydrationWarning>{article.source} · {ago(article.publishedAt)}</span>
      </a>
      <button className="fd-ask icon" type="button" onClick={ask} aria-label={`Ask Orbis about: ${article.title}`} title="Ask Orbis about this">
        <Sparkles size={14} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * What is happening in India and the world, and what it may mean for the
 * market. Sits under the brief and the mail. The headlines come from NewsData;
 * the one-line reasons and the sector reading are a model's, and say so.
 */
export function NewsCard() {
  const [state, setState] = useState<State>(() => (lastDigest && Date.now() - lastDigest.at < CLIENT_TTL_MS ? { status: 'ready', digest: lastDigest.digest } : { status: 'loading' }));

  useEffect(() => {
    if (lastDigest && Date.now() - lastDigest.at < CLIENT_TTL_MS) return;
    let live = true;
    void fetch('/api/home/news', { cache: 'no-store' })
      .then(async (response) => (response.ok ? await response.json() as NewsDigest : null))
      .catch(() => null)
      .then((digest) => {
        if (!live) return;
        if (!digest) return setState({ status: 'error' });
        if (digest.state === 'ok') lastDigest = { at: Date.now(), digest };
        setState({ status: 'ready', digest });
      });
    return () => { live = false; };
  }, []);

  if (state.status === 'loading') {
    return <p className="fd-weather-quiet" role="status"><LoaderCircle className="workbook-spinner" size={14} /> Reading today’s news…</p>;
  }
  if (state.status === 'error' || state.digest.state === 'unavailable') {
    return <p className="fd-weather-quiet"><Newspaper size={14} aria-hidden="true" /> The news couldn’t be reached. Opening Home again tries once more.</p>;
  }
  const { digest } = state;
  if (digest.state === 'not_configured') {
    return <p className="fd-weather-quiet"><Newspaper size={14} aria-hidden="true" /> News isn’t set up on this server yet.</p>;
  }

  const byId = new Map(digest.articles.map((article) => [article.id, article]));
  const analysis = digest.analysis;
  const picked = analysis
    ? analysis.headlines.flatMap(({ articleId, line }) => {
      const article = byId.get(articleId);
      return article ? [{ article, line }] : [];
    })
    : digest.articles.slice(0, PLAIN_HEADLINES).map((article) => ({ article, line: undefined }));

  return (
    <section className="fd-quiet fd-news" aria-labelledby="news-title">
      <h2 id="news-title">News</h2>

      {analysis && (
        <div className="fd-news-market">
          <p className="fd-news-market-head">Market read</p>
          <p className="fd-news-summary">{analysis.market.summary}</p>
          {analysis.market.sectors.length > 0 && (
            <ul className="fd-news-sectors">
              {analysis.market.sectors.map((sector) => {
                const outlook = OUTLOOK[sector.outlook];
                const Icon = outlook.icon;
                return (
                  <li key={sector.sector} className={`fd-news-sector is-${sector.outlook}`}>
                    <span className="fd-news-sector-name"><Icon size={13} strokeWidth={2.4} aria-hidden="true" />{sector.sector}<span className="sr-only"> {outlook.label}</span></span>
                    <span className="fd-news-sector-why">{sector.why}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="fd-news-actions">
            <button
              className="fd-ask"
              type="button"
              onClick={() => openAsk(
                {
                  kind: 'market',
                  title: 'Today’s market read',
                  detail: [analysis.market.summary, ...analysis.market.sectors.map((sector) => `${sector.sector}: ${sector.outlook}, ${sector.why}`)].join(' '),
                },
                'Explain this market read in simple terms. Which sectors matter most and why?',
              )}
            >
              <Sparkles size={13} strokeWidth={2.2} aria-hidden="true" />Ask Orbis about this
            </button>
          </div>
        </div>
      )}

      {picked.map(({ article, line }) => <Headline key={article.id} article={article} line={line} />)}

      <p className="fd-news-foot">
        {analysis ? 'Reasons and market read are written by AI from the headlines. A reading of the news, not investment advice.' : 'Headlines via NewsData.'}
      </p>
    </section>
  );
}
