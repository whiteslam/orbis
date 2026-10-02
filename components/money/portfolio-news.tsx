'use client';

import { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, LoaderCircle, Newspaper, Sparkles } from 'lucide-react';
import { openAsk } from '@/lib/ask/about';
import type { Outlook, PortfolioNewsResult } from '@/lib/news/types';

const OUTLOOK: Record<Outlook, { icon: typeof ArrowUpRight; label: string }> = {
  up: { icon: ArrowUpRight, label: 'may help' },
  down: { icon: ArrowDownRight, label: 'may hurt' },
  mixed: { icon: ArrowRight, label: 'mixed' },
};

/**
 * Today's news read against what you hold. The reading of the news is shared
 * with Home's News card; only this half, which names your holdings, is yours.
 */
export function PortfolioNewsCard() {
  const [state, setState] = useState<PortfolioNewsResult | 'loading' | 'failed'>('loading');

  useEffect(() => {
    let live = true;
    void fetch('/api/invest/news', { cache: 'no-store' })
      .then(async (response) => (response.ok ? await response.json() as PortfolioNewsResult : null))
      .catch(() => null)
      .then((result) => { if (live) setState(result ?? 'failed'); });
    return () => { live = false; };
  }, []);

  if (state === 'loading') {
    return <p className="fd-weather-quiet" role="status"><LoaderCircle className="workbook-spinner" size={14} /> Reading today’s news against your holdings…</p>;
  }
  if (state === 'failed') return <p className="fd-weather-quiet"><Newspaper size={14} aria-hidden="true" /> The news brief couldn’t be loaded. Opening Investments again tries once more.</p>;
  if (state.state === 'empty') return null;
  if (state.state !== 'ok') return <p className="fd-weather-quiet"><Newspaper size={14} aria-hidden="true" /> {state.message}</p>;

  const { result } = state;
  return (
    <section className="fd-quiet fd-news" aria-labelledby="pf-news-title">
      <h2 id="pf-news-title">News and your holdings</h2>
      <div className="fd-news-market">
        <p className="fd-news-summary">{result.summary}</p>
        {result.impacts.length > 0 ? (
          <ul className="fd-news-sectors">
            {result.impacts.map((impact) => {
              const outlook = OUTLOOK[impact.outlook];
              const Icon = outlook.icon;
              return (
                <li key={impact.holding} className={`fd-news-sector is-${impact.outlook}`}>
                  <div className="fd-news-item">
                    <span className="fd-news-row">
                      <span className="fd-news-sector-name"><Icon size={13} strokeWidth={2.4} aria-hidden="true" />{impact.holding}<span className="sr-only"> {outlook.label}</span></span>
                      <span className="fd-news-sector-why">{impact.why}</span>
                    </span>
                    <button
                      className="fd-ask icon"
                      type="button"
                      onClick={() => openAsk(
                        { kind: 'holding', title: impact.holding, detail: `Today's news ${outlook.label} this holding: ${impact.why}` },
                        `Why might today's news ${outlook.label === 'mixed' ? 'affect' : outlook.label.replace('may ', '')} ${impact.holding}, and what should I keep an eye on?`,
                      )}
                      aria-label={`Ask Orbis about ${impact.holding}`}
                      title="Ask Orbis about this"
                    >
                      <Sparkles size={14} strokeWidth={2.2} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <p className="fd-news-line">Nothing in today’s news touches what you hold directly.</p>}
        <div className="fd-news-actions">
          <button
            className="fd-ask"
            type="button"
            onClick={() => openAsk(
              { kind: 'market', title: 'News and your holdings', detail: [result.summary, ...result.impacts.map((impact) => `${impact.holding}: ${impact.outlook}, ${impact.why}`)].join(' ') },
              'Explain how today’s news affects my holdings, in simple terms.',
            )}
          >
            <Sparkles size={13} strokeWidth={2.2} aria-hidden="true" />Ask Orbis about this
          </button>
        </div>
      </div>
      <p className="fd-news-foot">Written by AI from today’s headlines and your holdings. A reading of the news, not investment advice; it never tells you to buy or sell.</p>
    </section>
  );
}
