/** One article as Orbis keeps it: never the body, only what a headline row needs. */
export type NewsArticle = {
  id: string;
  title: string;
  description: string;
  url: string;
  source: string;
  publishedAt: string;
  /** 'india' for Indian business news, 'world' for everything else. */
  desk: 'india' | 'world';
};

export type Outlook = 'up' | 'down' | 'mixed';

/** What a model made of a batch of headlines. Every headline points at a real article by id. */
export type NewsAnalysis = {
  headlines: Array<{ articleId: string; line: string }>;
  market: {
    summary: string;
    sectors: Array<{ sector: string; outlook: Outlook; why: string }>;
  };
};

/** What Home's News card receives. */
export type NewsDigest =
  | { state: 'not_configured' }
  | { state: 'unavailable' }
  | {
    state: 'ok';
    fetchedAt: string;
    articles: NewsArticle[];
    /** Null when AI is off for this person, or no model answered. */
    analysis: NewsAnalysis | null;
    /** Identifies this batch, so an analysis of your holdings can tell when the news moved. */
    batch: string;
  };

/** The news read against what you hold, for the Investments tab. */
export type PortfolioNews = {
  summary: string;
  impacts: Array<{ holding: string; outlook: Outlook; why: string }>;
};

export type PortfolioNewsResult =
  | { state: 'ok'; result: PortfolioNews; generatedAt: string; fresh: boolean }
  | { state: 'empty' }
  | { state: 'off'; message: string }
  | { state: 'error'; message: string };
