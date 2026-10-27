// Research desk rows, read defensively: anything the worker or an older
// migration wrote in a shape the screens don't expect is dropped rather than
// handed to them. Pure, so it is tested without a database.

import { isRecord } from '@/lib/ai/json';
import {
  AGENTS, DEFAULT_RESEARCH_SETTINGS, EVENT_KINDS, EXCHANGES, RATINGS, RUN_SOURCES, RUN_STATUSES, SETTINGS_LIMITS,
  type PortfolioContext, type ResearchDecision, type ResearchEvent, type ResearchRun, type ResearchSettings,
  type ResearchSettlement, type RunStatus,
} from '@/lib/research/types';

type Row = Record<string, unknown>;

const str = (value: unknown) => (typeof value === 'string' ? value : null);
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);
/** Numbers, including Postgres numerics, which PostgREST sends as strings. */
function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | null =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;

export function readDecision(value: unknown): ResearchDecision | null {
  if (!isRecord(value)) return null;
  const rating = value.rating === 'REVIEW' ? 'REVIEW' : oneOf(value.rating, RATINGS);
  if (!rating) return null;
  return {
    rating,
    summary: text(value.summary),
    thesis: text(value.thesis),
    priceTarget: num(value.priceTarget),
    horizon: text(value.horizon),
    entry: num(value.entry),
    stop: num(value.stop),
    sizing: text(value.sizing),
    trader: oneOf(value.trader, ['Buy', 'Hold', 'Sell'] as const),
  };
}

function readPortfolio(value: unknown): PortfolioContext | null {
  if (!isRecord(value) || !Array.isArray(value.positions)) return null;
  const positions = value.positions.flatMap((item) => {
    if (!isRecord(item)) return [];
    const ticker = str(item.ticker);
    const quantity = num(item.quantity);
    return ticker && quantity !== null ? [{ ticker, quantity, average_price: num(item.average_price) }] : [];
  });
  return { currency: 'INR', cash: num(value.cash), positions };
}

export function readRun(row: unknown): ResearchRun | null {
  if (!isRecord(row)) return null;
  const id = str(row.id);
  const ticker = str(row.ticker);
  const status = oneOf(row.status, RUN_STATUSES);
  const exchange = oneOf(row.exchange, EXCHANGES);
  const tradeDate = str(row.trade_date);
  const createdAt = str(row.created_at);
  if (!id || !ticker || !status || !exchange || !tradeDate || !createdAt) return null;
  return {
    id,
    ticker,
    symbol: str(row.symbol) ?? ticker,
    exchange,
    tradeDate,
    source: oneOf(row.source, RUN_SOURCES) ?? 'manual',
    status,
    portfolio: readPortfolio(row.portfolio_context),
    decision: readDecision(row.decision),
    costUsd: num(row.cost_usd),
    tokens: num(row.tokens),
    error: text(row.error),
    dispatchedAt: str(row.dispatched_at),
    startedAt: str(row.started_at),
    finishedAt: str(row.finished_at),
    createdAt,
  };
}

export function readEvent(row: unknown): ResearchEvent | null {
  if (!isRecord(row)) return null;
  const seq = num(row.seq);
  const agent = oneOf(row.agent, AGENTS);
  const kind = oneOf(row.kind, EVENT_KINDS);
  const content = str(row.content);
  const at = str(row.at);
  if (seq === null || !agent || !kind || content === null || !at) return null;
  return { seq, agent, kind, content, at };
}

export function readSettlement(row: unknown): ResearchSettlement | null {
  if (!isRecord(row)) return null;
  const runId = str(row.run_id);
  const ticker = str(row.ticker);
  const tradeDate = str(row.trade_date);
  const returnPct = num(row.return_pct);
  const benchmarkPct = num(row.benchmark_pct);
  const alphaPct = num(row.alpha_pct);
  const settledAt = str(row.settled_at);
  if (!runId || !ticker || !tradeDate || returnPct === null || benchmarkPct === null || alphaPct === null || !settledAt) return null;
  return {
    runId, ticker, tradeDate, returnPct, benchmarkPct, alphaPct, settledAt,
    benchmark: str(row.benchmark) ?? (ticker.endsWith('.BO') ? '^BSESN' : '^NSEI'),
    holdingDays: num(row.holding_days) ?? 5,
    reflection: text(row.reflection),
  };
}

function within(value: unknown, limits: { min: number; max: number }, fallback: number) {
  const parsed = num(value);
  return parsed !== null && Number.isInteger(parsed) && parsed >= limits.min && parsed <= limits.max ? parsed : fallback;
}

/** A model id OpenRouter could accept: `vendor/model`, nothing else. */
export const isModelId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,39}\/[a-z0-9][a-z0-9._:-]{0,79}$/i.test(value);

/** The saved settings over the defaults: a new setting needs no migration and a bad value falls back. */
export function readSettings(row: unknown): ResearchSettings {
  const defaults = DEFAULT_RESEARCH_SETTINGS;
  if (!isRecord(row)) return { ...defaults };
  return {
    enabled: typeof row.enabled === 'boolean' ? row.enabled : defaults.enabled,
    weeklyEnabled: typeof row.weekly_enabled === 'boolean' ? row.weekly_enabled : defaults.weeklyEnabled,
    weeklyTopN: within(row.weekly_top_n, SETTINGS_LIMITS.weeklyTopN, defaults.weeklyTopN),
    deepModel: isModelId(row.deep_model) ? row.deep_model : defaults.deepModel,
    quickModel: isModelId(row.quick_model) ? row.quick_model : defaults.quickModel,
    runTokenCap: within(row.run_token_cap, SETTINGS_LIMITS.runTokenCap, defaults.runTokenCap),
    monthlyRunCap: within(row.monthly_run_cap, SETTINGS_LIMITS.monthlyRunCap, defaults.monthlyRunCap),
  };
}

/** Longer than this unclaimed, the worker never got the job (a failed dispatch, a full queue). */
export const UNCLAIMED_AFTER_MS = 45 * 60_000;
/** Longer than this running, the job died without saying so (the workflow's own limit is 120 minutes). */
export const STALLED_AFTER_MS = 120 * 60_000;

/** The status to show: a run that can no longer finish reads as failed, whatever its row says. */
export function effectiveStatus(run: ResearchRun, now: Date): RunStatus {
  const since = (iso: string | null) => (iso ? now.getTime() - new Date(iso).getTime() : 0);
  if (run.status === 'queued' && since(run.dispatchedAt ?? run.createdAt) > UNCLAIMED_AFTER_MS) return 'failed';
  if (run.status === 'running' && since(run.startedAt) > STALLED_AFTER_MS) return 'failed';
  return run.status;
}

/**
 * The owner's change to the settings, checked field by field: anything not a
 * known setting, or out of range, refuses the whole patch rather than saving
 * half of it.
 */
export function applySettingsPatch(current: ResearchSettings, patch: unknown): ResearchSettings | null {
  if (!isRecord(patch)) return null;
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    switch (key) {
      case 'enabled':
      case 'weeklyEnabled':
        if (typeof value !== 'boolean') return null;
        next[key] = value;
        break;
      case 'weeklyTopN':
      case 'runTokenCap':
      case 'monthlyRunCap': {
        const limits = SETTINGS_LIMITS[key];
        if (typeof value !== 'number' || !Number.isInteger(value) || value < limits.min || value > limits.max) return null;
        next[key] = value;
        break;
      }
      case 'deepModel':
      case 'quickModel':
        if (!isModelId(value)) return null;
        next[key] = value;
        break;
      default:
        return null;
    }
  }
  return next;
}
