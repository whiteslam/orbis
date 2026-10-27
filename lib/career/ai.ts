import 'server-only';

import { aiBlocked } from '@/lib/ai/gate';
import { claimAiCredit, type AiQuotaFeature } from '@/lib/ai/quota';
import { routeJson, type Sensitivity } from '@/lib/ai/router';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildAlertPrompt, parseAlertReply, type AlertPromptInput } from '@/lib/career/alerts';
import { buildFollowUpPrompt, parseFollowUpReply, type FollowUpInput } from '@/lib/career/followup';
import { buildReplyPrompt, parseReplyReply } from '@/lib/career/mail';
import { buildOfferPrompt, parseOfferReply } from '@/lib/career/offer';
import { buildPrepPrompt, parsePrepReply } from '@/lib/career/prep';
import { buildRequirementsPrompt, parseRequirementsReply } from '@/lib/career/requirements';
import { buildResumePrompt, parseResumeReply } from '@/lib/career/resume-parse';
import { buildSpecPrompt, parseSpecReply } from '@/lib/career/spec';
import { buildTailorPrompt, parseTailorReply, type TailorInput, type TailorReply } from '@/lib/career/tailor';
import type {
  CareerProfile, CareerSpec, InterviewPrep, NormalizedJob, OfferAdvice, ReplyClassification, Requirements,
} from '@/lib/career/types';

// Every AI job Career runs, one function each. Each one asks the gate, claims a
// daily credit for its own feature, and routes with `accept` set to "the pure
// parser can use it", so a model that answers with broken JSON makes the router
// try the next one instead of failing the job. All return the parsed result,
// or null when AI is off, the day's credits are spent, or no model answered.

type CareerFeature = Extract<AiQuotaFeature, `career_${string}`>;

type JobConfig = {
  /** Daily credits. The owner lifted the cost cap; these only stop a runaway loop. */
  daily: number;
  sensitivity: Sensitivity;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
};

/**
 * Per-feature settings. Extraction and classification run cold (0.1) so the
 * output sticks to what the text says; writing for a person runs warmer.
 * Requirements, alerts and mail are read by the crons in bulk, hence hundreds
 * a day; the rest follow an owner's press or a rare event.
 */
export const CAREER_AI: Readonly<Record<CareerFeature, JobConfig>> = {
  career_profile: { daily: 30, sensitivity: 'personal', maxTokens: 8000, temperature: 0.1, timeoutMs: 45_000 },
  career_spec: { daily: 40, sensitivity: 'personal', maxTokens: 1500, temperature: 0.2, timeoutMs: 20_000 },
  career_requirements: { daily: 800, sensitivity: 'general', maxTokens: 1800, temperature: 0.1, timeoutMs: 20_000 },
  career_tailor: { daily: 80, sensitivity: 'personal', maxTokens: 6000, temperature: 0.3, timeoutMs: 40_000 },
  career_alerts: { daily: 400, sensitivity: 'personal', maxTokens: 3000, temperature: 0.1, timeoutMs: 25_000 },
  career_mail: { daily: 600, sensitivity: 'personal', maxTokens: 700, temperature: 0.1, timeoutMs: 15_000 },
  career_offer: { daily: 30, sensitivity: 'personal', maxTokens: 2500, temperature: 0.4, timeoutMs: 35_000 },
  career_prep: { daily: 40, sensitivity: 'personal', maxTokens: 3500, temperature: 0.4, timeoutMs: 35_000 },
  career_followup: { daily: 100, sensitivity: 'personal', maxTokens: 500, temperature: 0.5, timeoutMs: 15_000 },
};

// A cron run asks for dozens of jobs for one person within seconds; the answer
// to "is AI on, and can anything run" does not change that fast.
const GATE_TTL_MS = 60_000;
const gateCache = new Map<string, { until: number; blocked: Awaited<ReturnType<typeof aiBlocked>> }>();

/** aiBlocked, remembered for a minute per person. 'off', 'unavailable' or null (go ahead). */
export async function careerAiGate(userId: string): Promise<Awaited<ReturnType<typeof aiBlocked>>> {
  const cached = gateCache.get(userId);
  if (cached && cached.until > Date.now()) return cached.blocked;
  const blocked = await aiBlocked(userId);
  gateCache.set(userId, { until: Date.now() + GATE_TTL_MS, blocked });
  return blocked;
}

async function claim(userId: string, feature: CareerFeature): Promise<boolean> {
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return false;
  }
  const credit = await claimAiCredit((fn, args) => admin.rpc(fn, args), userId, feature, CAREER_AI[feature].daily);
  if (credit === 'limit') console.warn(`Career AI: today's ${feature} credits are used up`);
  return credit === 'ok';
}

type Prompt = { system: string; user: string };

/** Overrides a caller may need: a cron with little time left asks for a shorter wait. */
export type AiOptions = { timeoutMs?: number };

/** Gate, credit, route, parse. The parse that `accept` already ran is the one returned. */
async function run<T>(userId: string, feature: CareerFeature, prompt: Prompt, parse: (text: string) => T | null, options: AiOptions = {}): Promise<T | null> {
  if (await careerAiGate(userId)) return null;
  if (!(await claim(userId, feature))) return null;
  const config = CAREER_AI[feature];
  const kept: { value: T | null } = { value: null };
  const result = await routeJson({
    userId,
    feature,
    sensitivity: config.sensitivity,
    system: prompt.system,
    user: prompt.user,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    timeoutMs: Math.max(5_000, Math.min(options.timeoutMs ?? config.timeoutMs, config.timeoutMs)),
    accept: (text) => {
      kept.value = parse(text);
      return kept.value !== null;
    },
  });
  if (!result) return null;
  return kept.value ?? parse(result.text);
}

/** The resume's text as a structured profile (new ids; merge with the saved one before saving). */
export function parseResume(userId: string, resumeText: string): Promise<CareerProfile | null> {
  return run(userId, 'career_profile', buildResumePrompt(resumeText), (text) => parseResumeReply(text, resumeText));
}

/** "Senior React roles, remote, ₹40L+" as a spec. */
export function specFromText(userId: string, sentence: string, profile: CareerProfile | null): Promise<CareerSpec | null> {
  return run(userId, 'career_spec', buildSpecPrompt(sentence, profile), parseSpecReply);
}

/** What a job asks for. Only for a job with a description; a thin one has nothing to read. */
export function extractRequirements(userId: string, job: NormalizedJob, options?: AiOptions): Promise<Requirements | null> {
  return run(userId, 'career_requirements', buildRequirementsPrompt(job), parseRequirementsReply, options);
}

/** The tailored draft, cover note, answers and outreach, before the truth check. */
export function tailorApplication(userId: string, input: TailorInput, options?: AiOptions): Promise<TailorReply | null> {
  return run(userId, 'career_tailor', buildTailorPrompt(input), (text) => parseTailorReply(text, input.profile), options);
}

/**
 * The jobs in one alert email. An empty list is a real answer (an alert with
 * nothing in it); null means nobody answered.
 */
export function readAlertEmail(userId: string, input: AlertPromptInput, allowedUrls: string[], options?: AiOptions): Promise<NormalizedJob[] | null> {
  // Accepted when it is a jobs list at all, even an empty one: parseAlertReply never says null.
  const parse = (text: string) => (/"jobs"\s*:|^\s*\[/.test(text) ? parseAlertReply(text, allowedUrls, input.senderLabel) : null);
  return run(userId, 'career_alerts', buildAlertPrompt(input), parse, options);
}

/** What one reply means: acknowledgement, rejection, invite, assessment, question, offer or other. */
export function classifyReply(userId: string, input: { from: string; subject: string; body: string }, options?: AiOptions): Promise<ReplyClassification | null> {
  return run(userId, 'career_mail', buildReplyPrompt(input), parseReplyReply, options);
}

/** Advice on an offer. The caller applies capCounter (lib/career/offer.ts) with the terms and the market. */
export function adviseOffer(userId: string, input: Parameters<typeof buildOfferPrompt>[0]): Promise<OfferAdvice | null> {
  return run(userId, 'career_offer', buildOfferPrompt(input), parseOfferReply);
}

/** The interview prep pack; stories citing a fact the profile lacks are dropped by the parser. */
export function prepPack(
  userId: string,
  input: Parameters<typeof buildPrepPrompt>[0] & { logistics: InterviewPrep['logistics'] },
  options?: AiOptions,
): Promise<InterviewPrep | null> {
  const { logistics, ...prompt } = input;
  return run(userId, 'career_prep', buildPrepPrompt(prompt), (text) => parsePrepReply(text, input.profile, logistics), options);
}

/** A short follow-up for an application with no reply. Null leaves the caller to use fallbackFollowUp. */
export function draftFollowUp(userId: string, input: FollowUpInput, options?: AiOptions): Promise<string | null> {
  return run(userId, 'career_followup', buildFollowUpPrompt(input), parseFollowUpReply, options);
}
