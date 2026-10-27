/**
 * What AI may cost, and which models a request may try in what order.
 *
 * Pure, so every rule here is unit-tested. Prices live in the registry
 * (ai_models.input_usd_per_mtok / output_usd_per_mtok), the budget in the
 * environment; nothing about money is written into a feature.
 *
 * Free models cost nothing and are never limited by the budget. By default
 * there is no monthly cap: the owner chose capability over cost (2026-10-27),
 * so paid models go first for the features where quality matters most. A
 * positive ORBIS_AI_MONTHLY_BUDGET_INR brings a cap back (below ₹500 paid
 * models are only a fallback; from ₹500 they lead for quality features), and
 * 0 means paid models never run. That is a change to the environment, not to code.
 */
import type { TokenUsage } from '@/lib/ai/attempt';

export type Priced = { id: string; order: number; paid: boolean; inputUsdPerMTok: number; outputUsdPerMTok: number };

export type PaidRouting = 'fallback' | 'quality';
export type BudgetState = 'normal' | 'warning' | 'critical';
export type BudgetConfig = { monthlyInr: number; usdInr: number; paidRouting: PaidRouting };

/** No cap unless the environment sets one. */
const DEFAULT_MONTHLY_INR = Number.POSITIVE_INFINITY;
// Only used to compare a dollar-priced bill with a rupee budget. Set
// ORBIS_AI_USD_INR to the rate on your card statement; this is a placeholder.
const DEFAULT_USD_INR = 88;
/** From this budget up, quality features try the paid model first unless told otherwise. */
const QUALITY_FROM_INR = 500;
/** Share of the month's budget after which paid models are only a last resort. */
const WARNING_SHARE = 0.8;

/** Where answer quality is worth paying for first, when the budget allows it. */
const QUALITY_FEATURES = new Set(['ask_orbis', 'talk_orbis', 'health_plan', 'health_plan_questions', 'workbook_advice', 'portfolio_advice', 'news_digest', 'portfolio_news', 'career_profile', 'career_tailor', 'career_offer', 'career_prep']);
/** Where Orbis's own wording is already fine, so no request is ever paid for. */
const FREE_ONLY_FEATURES = new Set(['headsups']);

/** About four characters a token: an upper-bound guess used only before a request, never logged as usage. */
export const CHARS_PER_TOKEN = 4;

export function attemptCostUsd(usage: TokenUsage | null, model: Pick<Priced, 'inputUsdPerMTok' | 'outputUsdPerMTok'>) {
  if (!usage) return 0;
  return (usage.inputTokens * model.inputUsdPerMTok + usage.outputTokens * model.outputUsdPerMTok) / 1_000_000;
}

/** The most a request could cost on this model: its whole prompt plus every allowed output token. */
export function worstCaseCostUsd(promptChars: number, maxTokens: number, model: Pick<Priced, 'inputUsdPerMTok' | 'outputUsdPerMTok'>) {
  return attemptCostUsd({ inputTokens: Math.ceil(promptChars / CHARS_PER_TOKEN), outputTokens: maxTokens }, model);
}

function positive(value: string | undefined, fallback: number, allowZero = false) {
  const number = Number(value?.trim());
  if (value === undefined || value.trim() === '' || !Number.isFinite(number)) return fallback;
  return number > 0 || (allowZero && number === 0) ? number : fallback;
}

/** The routing the env asks for, else quality once the budget is big enough for it. */
function paidRoutingFor(routing: string | undefined, monthlyInr: number): PaidRouting {
  if (routing === 'fallback' || routing === 'quality') return routing;
  return monthlyInr >= QUALITY_FROM_INR ? 'quality' : 'fallback';
}

export function budgetConfig(env: Record<string, string | undefined>): BudgetConfig {
  const monthlyInr = positive(env.ORBIS_AI_MONTHLY_BUDGET_INR, DEFAULT_MONTHLY_INR, true);
  return {
    monthlyInr,
    usdInr: positive(env.ORBIS_AI_USD_INR, DEFAULT_USD_INR),
    paidRouting: paidRoutingFor(env.ORBIS_AI_PAID_ROUTING?.trim(), monthlyInr),
  };
}

/** Whether the month's spend is capped at all. */
export function budgetCapped(config: Pick<BudgetConfig, 'monthlyInr'>) {
  return Number.isFinite(config.monthlyInr);
}

export function budgetState(spentUsd: number, config: BudgetConfig): BudgetState {
  if (!budgetCapped(config)) return 'normal';
  // In whole paise, so a float like 239.99999999 does not decide the state.
  const spentInr = Math.round(spentUsd * config.usdInr * 100) / 100;
  if (spentInr >= config.monthlyInr) return 'critical';
  if (spentInr >= config.monthlyInr * WARNING_SHARE) return 'warning';
  return 'normal';
}

/**
 * The models a request may try, in order. `escalate` is a verdict about this
 * one request, when there is one. The registry's own order is kept
 * within free and within paid models; this only decides where paid ones go,
 * and whether they go at all.
 */
export function orderCandidates<T extends Priced>(candidates: T[], input: { feature: string; paidRouting: PaidRouting; state: BudgetState; escalate?: boolean }): T[] {
  const sorted = [...candidates].sort((left, right) => left.order - right.order);
  const free = sorted.filter((candidate) => !candidate.paid);
  if (input.state === 'critical' || FREE_ONLY_FEATURES.has(input.feature)) return free;
  const paid = sorted.filter((candidate) => candidate.paid);
  // A per-request verdict (Jev's, in lib/ai/decide.ts) replaces the mode's rule
  // for this request only; the budget and free-only features still win.
  const wantsPaid = input.escalate ?? (input.paidRouting === 'quality' && QUALITY_FEATURES.has(input.feature));
  const paidFirst = input.state === 'normal' && wantsPaid;
  return paidFirst ? [...paid, ...free] : [...free, ...paid];
}

/**
 * At most `max` attempts, in the given order, but with room kept for the paid
 * model: with five free models and Haiku as the fallback, the fallback must
 * not be the one that is cut.
 */
export function capAttempts<T extends Pick<Priced, 'paid'>>(ordered: T[], max: number): T[] {
  const paid = ordered.filter((candidate) => candidate.paid).slice(0, max);
  let freeRoom = max - paid.length;
  return ordered.filter((candidate) => candidate.paid ? paid.includes(candidate) : freeRoom-- > 0);
}

/** Whether a paid attempt's worst case still fits inside the month's budget. */
export function paidAffordable(request: { promptChars: number; maxTokens: number }, model: Priced, spentUsd: number, config: BudgetConfig) {
  if (!budgetCapped(config)) return true;
  const leftUsd = config.monthlyInr / config.usdInr - spentUsd;
  return worstCaseCostUsd(request.promptChars, request.maxTokens, model) <= leftUsd;
}

const IST_OFFSET_MS = 330 * 60_000;

/** When this budget month began: midnight on the 1st in India, as a UTC instant. */
export function monthStartIso(now: Date) {
  const india = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(india.getUTCFullYear(), india.getUTCMonth(), 1) - IST_OFFSET_MS).toISOString();
}
