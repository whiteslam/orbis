/**
 * Reply and interview chances, and the 14-day pipeline forecast. Pure.
 *
 * Two small logistic models over the same six features. They start from a
 * written-down prior (below) and learn from the owner's own outcomes once there
 * are enough of them. Every number leaves here with a range and an "early"
 * flag: the design forbids a bare percentage shown as if it were known.
 */
import type { ApplyRoute, CareerInsights, CareerSpec, Money, Prediction, Requirements, SalaryPeriod, Seniority } from './types.ts';
import { daysBetween } from './followup.ts';

export type Fit = -1 | 0 | 1;

export type Features = {
  route: ApplyRoute;
  /** Match score, 0–100. */
  score: number;
  /** Days from posting to applying; null when the posting date is unknown. */
  freshnessDays: number | null;
  /** −1 below the owner's floor, 1 at or above their target, 0 in between or unknown. */
  salaryFit: Fit;
  /** 1 when the job's level is one the owner wants, −1 when it isn't, 0 unknown. */
  seniorityFit: Fit;
  /** Only a title and a line are known (a job-alert email). */
  thin: boolean;
};

/** The feature vector: [intercept, email, recruitee, score, freshness, salary, seniority, thin]. */
export function vectorOf(features: Features): number[] {
  // Centred so the intercept is the chance of a typical application: score 50,
  // three days after posting. Log days, because day 1 vs 4 matters more than 21 vs 24.
  const days = features.freshnessDays === null ? 3 : Math.min(Math.max(features.freshnessDays, 0), 60);
  return [
    1,
    features.route === 'email' ? 1 : 0,
    features.route === 'recruitee' ? 1 : 0,
    (features.score - 50) / 25,
    Math.log1p(days) - Math.log1p(3),
    features.salaryFit,
    features.seniorityFit,
    features.thin ? 1 : 0,
  ];
}

/**
 * The prior, before the owner has any outcomes. Coefficients are log-odds.
 *
 * Reply (any reply from a person or ATS, rejections included):
 * - intercept −1.99 = logit(0.12): cold applications through a listing's link
 *   hear back roughly one time in eight;
 * - email +0.90 (≈25%): a direct email reaches a person and is easy to answer;
 *   recruitee +0.35 (≈16%): it lands in the ATS, but as a direct candidate;
 * - score +0.45 per 25 points: a closer match gets past screeners more often;
 * - freshness −0.35 per log-day: early applicants are read before the pile
 *   grows (same day ≈ ×1.6 odds, a month late ≈ ×0.5);
 * - salary +0.25 and seniority +0.35 per step: asks that fit the band and level
 *   get screened in more often;
 * - thin −0.25: alert-email listings are mostly mass-applied board posts.
 *
 * Interview: intercept −3.18 = logit(0.04), about one in three replies. Match
 * and level matter more to an interview than to a reply (score +0.70,
 * seniority +0.50); route and freshness matter a little less.
 */
export const PRIOR = {
  reply: [-1.99, 0.9, 0.35, 0.45, -0.35, 0.25, 0.35, -0.25],
  interview: [-3.18, 0.8, 0.3, 0.7, -0.25, 0.3, 0.5, -0.3],
} as const;

export type Model = { weights: number[]; n: number; early: boolean };
export type CareerModel = { reply: Model; interview: Model };

export const PRIOR_MODEL: CareerModel = {
  reply: { weights: [...PRIOR.reply], n: 0, early: true },
  interview: { weights: [...PRIOR.interview], n: 0, early: true },
};

/** Resolved outcomes needed before the model learns from the owner's own data. */
export const MIN_OUTCOMES = 15;
/** The prior keeps weight 30 / (n + 30) after learning starts. */
export const PRIOR_STRENGTH = 30;
/** What the prior is worth in observations when sizing the range: a little, so early ranges are wide. */
export const PRIOR_EFFECTIVE_N = 10;

const ITERATIONS = 600;
const LEARNING_RATE = 0.5;
const L2 = 1;
const WEIGHT_LIMIT = 8;

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

function dot(a: readonly number[], b: readonly number[]) {
  let sum = 0;
  for (const [index, value] of a.entries()) sum += value * (b[index] ?? 0);
  return sum;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/**
 * L2-regularised logistic regression by full-batch gradient descent. Fixed
 * iterations from zero weights, so the same outcomes always give the same model.
 * The intercept isn't penalised.
 */
export function fitLogistic(rows: number[][], labels: boolean[]): number[] {
  const size = rows[0]?.length ?? 0;
  const weights = new Array<number>(size).fill(0);
  const n = rows.length;
  if (!n) return weights;
  for (let step = 0; step < ITERATIONS; step += 1) {
    const gradient = new Array<number>(size).fill(0);
    for (const [row, x] of rows.entries()) {
      const error = sigmoid(dot(weights, x)) - (labels[row] ? 1 : 0);
      for (let k = 0; k < size; k += 1) gradient[k] += error * x[k];
    }
    for (let k = 0; k < size; k += 1) {
      const penalty = k === 0 ? 0 : L2 * weights[k];
      weights[k] = clamp(weights[k] - (LEARNING_RATE * (gradient[k] + penalty)) / n, -WEIGHT_LIMIT, WEIGHT_LIMIT);
    }
  }
  return weights;
}

function blend(prior: readonly number[], fitted: number[], n: number) {
  const share = n / (n + PRIOR_STRENGTH);
  return prior.map((weight, k) => share * (fitted[k] ?? 0) + (1 - share) * weight);
}

export type Outcome = { features: Features; replied: boolean; interviewed: boolean };

/**
 * The models for these resolved outcomes (a reply of any kind, a rejection, or
 * ghosted). Below MIN_OUTCOMES it is the prior, flagged early.
 */
export function train(outcomes: Outcome[]): CareerModel {
  const n = outcomes.length;
  if (n < MIN_OUTCOMES) {
    return {
      reply: { ...PRIOR_MODEL.reply, n },
      interview: { ...PRIOR_MODEL.interview, n },
    };
  }
  const rows = outcomes.map((outcome) => vectorOf(outcome.features));
  const reply = fitLogistic(rows, outcomes.map((outcome) => outcome.replied));
  const interview = fitLogistic(rows, outcomes.map((outcome) => outcome.interviewed));
  return {
    reply: { weights: blend(PRIOR.reply, reply, n), n, early: false },
    interview: { weights: blend(PRIOR.interview, interview, n), n, early: false },
  };
}

/**
 * The chance and an approximate 95% range. The range is a binomial
 * approximation, p ± 1.96·√(p(1−p)/n_eff) with n_eff = 10 + outcomes learned
 * from: honest about how little is known, not a true posterior interval.
 */
export function predict(features: Features, model: Model): { p: number; range: [number, number] } {
  const p = sigmoid(dot(model.weights, vectorOf(features)));
  const half = 1.96 * Math.sqrt((p * (1 - p)) / (PRIOR_EFFECTIVE_N + model.n));
  return { p, range: [clamp(p - half, 0, 1), clamp(p + half, 0, 1)] };
}

// ─── Features from an application ────────────────────────────────────────

const PER_YEAR: Record<SalaryPeriod, number> = { year: 1, month: 12, hour: 2080 };

function yearly(money: Pick<Money, 'amount' | 'period'>) {
  return money.amount * PER_YEAR[money.period];
}

type JobSalary = { min: number | null; max: number | null; currency: string; period: SalaryPeriod } | null;

/** How the job's stated pay sits against the owner's floor and target, in the same currency only. */
export function salaryFitOf(salary: JobSalary, spec: Pick<CareerSpec, 'salaryFloor' | 'salaryTarget'>): Fit {
  const top = salary?.max ?? salary?.min ?? null;
  if (!salary || top === null) return 0;
  const offered = yearly({ amount: top, period: salary.period });
  const same = (money: Money | null) => (money && money.currency.toUpperCase() === salary.currency.toUpperCase() ? yearly(money) : null);
  const floor = same(spec.salaryFloor);
  const target = same(spec.salaryTarget);
  if (floor !== null && offered < floor) return -1;
  if (target !== null) return offered >= target ? 1 : 0;
  return floor === null ? 0 : 1;
}

/** Whether the job's level is one the owner is looking for. */
export function seniorityFitOf(level: Seniority | null | undefined, wanted: Seniority[]): Fit {
  if (!level || !wanted.length) return 0;
  return wanted.includes(level) ? 1 : -1;
}

export type ApplicationInput = {
  route: ApplyRoute;
  score: number;
  job: { postedAt: string | null; thin: boolean; salary: JobSalary; requirements?: Pick<Requirements, 'seniority' | 'salary'> | null };
  spec: Pick<CareerSpec, 'salaryFloor' | 'salaryTarget' | 'seniority'>;
  /** When it was (or will be) sent: the sent date, or today for a draft. */
  appliedAt: string;
};

export function featuresOf(input: ApplicationInput): Features {
  const freshness = input.job.postedAt ? daysBetween(input.job.postedAt, input.appliedAt) : null;
  return {
    route: input.route,
    score: input.score,
    freshnessDays: freshness === null ? null : Math.max(0, freshness),
    salaryFit: salaryFitOf(input.job.salary ?? input.job.requirements?.salary ?? null, input.spec),
    seniorityFit: seniorityFitOf(input.job.requirements?.seniority, input.spec.seniority),
    thin: input.job.thin,
  };
}

/** The snapshot stored on an application. */
export function predictApplication(input: ApplicationInput | Features, model: CareerModel): Prediction {
  const features = 'appliedAt' in input ? featuresOf(input) : input;
  const reply = predict(features, model.reply);
  const interview = predict(features, model.interview);
  return {
    reply: reply.p,
    replyRange: reply.range,
    interview: interview.p,
    interviewRange: interview.range,
    early: model.reply.early,
    basedOn: model.reply.n,
  };
}

// ─── Forecast ────────────────────────────────────────────────────────────

/**
 * Days from sending to a reply before there is data: most replies come in the
 * first week, with a tail to three weeks.
 */
export const PRIOR_REPLY_DELAYS = [1, 2, 3, 3, 5, 7, 7, 10, 14, 21];
/** Observed delays needed before they replace the prior. */
export const MIN_DELAYS = 10;
export const FORECAST_DAYS = 14;

function cdf(delays: number[], day: number) {
  let within = 0;
  for (const delay of delays) if (delay <= day) within += 1;
  return within / delays.length;
}

/** The chance a still-silent application answers in the next window, given it hasn't yet. */
function chanceInWindow(p: number, delays: number[], age: number) {
  const before = cdf(delays, age);
  const after = cdf(delays, age + FORECAST_DAYS);
  const silentSoFar = 1 - p * before;
  return silentSoFar <= 0 ? 0 : clamp((p * (after - before)) / silentSoFar, 0, 1);
}

type Expected = { low: number; high: number; variance: number };

function expectedCount(chances: Array<{ p: number; low: number; high: number; age: number }>, delays: number[]): Expected {
  const out: Expected = { low: 0, high: 0, variance: 0 };
  for (const chance of chances) {
    const mid = chanceInWindow(chance.p, delays, chance.age);
    out.low += chanceInWindow(chance.low, delays, chance.age);
    out.high += chanceInWindow(chance.high, delays, chance.age);
    out.variance += mid * (1 - mid);
  }
  return out;
}

/** Whole events: the chance band widened by the count's own spread, never below 0 or above `max`. */
function countRange(expected: Expected, max: number): [number, number] {
  const spread = 1.96 * Math.sqrt(expected.variance);
  const low = clamp(Math.round(expected.low - spread), 0, max);
  const high = clamp(Math.round(expected.high + spread), low, max);
  return [low, high];
}

/**
 * Expected replies and interviews in the next 14 days from applications still
 * awaiting a reply, their chances spread over the time to reply seen so far.
 */
export function forecast(openPredictions: Array<{ prediction: Prediction; sentAt: string }>, replyDelayDays: number[], today: string): CareerInsights['forecast'] {
  const observed = replyDelayDays.filter((delay) => Number.isFinite(delay) && delay >= 0);
  const fromData = observed.length >= MIN_DELAYS;
  const delays = fromData ? observed : PRIOR_REPLY_DELAYS;
  const ages = openPredictions.map((open) => Math.max(0, daysBetween(open.sentAt, today)));
  const replies = expectedCount(openPredictions.map((open, index) => ({
    p: open.prediction.reply, low: open.prediction.replyRange[0], high: open.prediction.replyRange[1], age: ages[index],
  })), delays);
  // Interviews follow replies, so the same timing is a fair first approximation.
  const interviews = expectedCount(openPredictions.map((open, index) => ({
    p: open.prediction.interview, low: open.prediction.interviewRange[0], high: open.prediction.interviewRange[1], age: ages[index],
  })), delays);
  const max = openPredictions.length;
  return {
    days: FORECAST_DAYS,
    replies: countRange(replies, max),
    interviews: countRange(interviews, max),
    early: !fromData || openPredictions.some((open) => open.prediction.early),
  };
}
