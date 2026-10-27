// The Research desk: TradingAgents runs on one Indian stock or ETF, for the
// owner only (docs/superpowers/specs/2026-10-27-research-desk-tradingagents-design.md).
// Client-safe: types, vocabularies and the fixed copy.

export const RUN_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const ACTIVE_STATUSES: readonly RunStatus[] = ['queued', 'running'];

/** Who wrote an event: the desk itself (progress notes) or one of the agents. */
export const AGENTS = [
  'desk', 'market', 'fundamentals', 'news', 'bull', 'bear', 'research_manager', 'trader',
  'risk_aggressive', 'risk_conservative', 'risk_neutral', 'portfolio_manager',
] as const;
export type Agent = (typeof AGENTS)[number];

export const EVENT_KINDS = ['status', 'report', 'turn', 'decision'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** TradingAgents' five-tier scale, most bullish first. */
export const RATINGS = ['Buy', 'Overweight', 'Hold', 'Underweight', 'Sell'] as const;
export type Rating = (typeof RATINGS)[number];

export const EXCHANGES = ['NSE', 'BSE'] as const;
export type Exchange = (typeof EXCHANGES)[number];

export const RUN_SOURCES = ['manual', 'weekly'] as const;
export type RunSource = (typeof RUN_SOURCES)[number];

/**
 * The Portfolio Manager's final call and the Trader's levels. `REVIEW` is
 * upstream's signal that the decision had no readable rating: shown as such,
 * never as a Hold.
 */
export type ResearchDecision = {
  rating: Rating | 'REVIEW';
  summary: string | null;
  thesis: string | null;
  priceTarget: number | null;
  horizon: string | null;
  entry: number | null;
  stop: number | null;
  sizing: string | null;
  trader: 'Buy' | 'Hold' | 'Sell' | null;
};

/** What the worker is told about the owner's book: never broker tokens, values in INR. */
export type PortfolioContext = {
  currency: 'INR';
  cash: number | null;
  positions: Array<{ ticker: string; quantity: number; average_price: number | null }>;
};

export type ResearchRun = {
  id: string;
  ticker: string;
  symbol: string;
  exchange: Exchange;
  tradeDate: string;
  source: RunSource;
  status: RunStatus;
  portfolio: PortfolioContext | null;
  decision: ResearchDecision | null;
  costUsd: number | null;
  tokens: number | null;
  error: string | null;
  dispatchedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export type ResearchEvent = { seq: number; agent: Agent; kind: EventKind; content: string; at: string };

export type ResearchSettlement = {
  runId: string;
  ticker: string;
  tradeDate: string;
  benchmark: string;
  holdingDays: number;
  returnPct: number;
  benchmarkPct: number;
  alphaPct: number;
  reflection: string | null;
  settledAt: string;
};

export type ResearchSettings = {
  enabled: boolean;
  weeklyEnabled: boolean;
  weeklyTopN: number;
  deepModel: string;
  quickModel: string;
  runTokenCap: number;
  monthlyRunCap: number;
};

/**
 * Sonnet for the deep tier (Research and Portfolio Managers), Haiku for the
 * quick tier (analysts, debaters, trader), through OpenRouter, in the dotted
 * ids OpenRouter uses (lib/ai: 'anthropic/claude-haiku-4.5'). The weekly run
 * stays off until the owner turns it on.
 */
export const DEFAULT_RESEARCH_SETTINGS: ResearchSettings = {
  enabled: true,
  weeklyEnabled: false,
  weeklyTopN: 5,
  deepModel: 'anthropic/claude-sonnet-5.5',
  quickModel: 'anthropic/claude-haiku-5.5',
  runTokenCap: 600_000,
  monthlyRunCap: 40,
};

export const SETTINGS_LIMITS = {
  weeklyTopN: { min: 1, max: 15 },
  runTokenCap: { min: 50_000, max: 3_000_000 },
  monthlyRunCap: { min: 1, max: 300 },
} as const;

/** Shown with every decision, word for word (the spec's Guardrails). */
export const RESEARCH_DISCLAIMER = 'Research output from AI agents, not investment advice. It can be wrong and it isn’t repeatable run to run.';

export const FUND_UNSUPPORTED = 'Not supported for funds';

export const AGENT_LABELS: Record<Agent, string> = {
  desk: 'Research desk',
  market: 'Market analyst',
  fundamentals: 'Fundamentals analyst',
  news: 'News analyst',
  bull: 'Bull researcher',
  bear: 'Bear researcher',
  research_manager: 'Research manager',
  trader: 'Trader',
  risk_aggressive: 'Aggressive risk',
  risk_conservative: 'Conservative risk',
  risk_neutral: 'Neutral risk',
  portfolio_manager: 'Portfolio manager',
};
