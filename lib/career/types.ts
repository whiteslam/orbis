/**
 * Career: Orbis runs the job hunt. Client-safe.
 *
 * The contract every career module shares: the profile and its facts, the
 * spec, a job from any source, what it asks for, how well it matches, and an
 * application from draft to outcome. See
 * docs/superpowers/specs/2026-10-27-career-copilot-design.md.
 */

// ─── Profile ─────────────────────────────────────────────────────────────

/** One true, atomic statement from the profile. Tailored text cites these by id. */
export type CareerFact = {
  /** Stable once made: 'f_' + 8 base36 chars. Edits keep the id. */
  id: string;
  text: string;
  /** The role it happened in, if any. */
  roleId: string | null;
  /** Normalised skill names this fact is evidence for. */
  skills: string[];
  /** True once the owner has edited or confirmed it; a re-upload never drops it. */
  confirmed: boolean;
};

export type CareerRole = {
  /** 'r_' + 8 base36 chars. */
  id: string;
  title: string;
  employer: string;
  location: string | null;
  /** 'YYYY-MM'. */
  start: string;
  /** 'YYYY-MM', or null while current. */
  end: string | null;
};

export type CareerEducation = {
  id: string;
  institution: string;
  degree: string;
  field: string | null;
  /** 'YYYY' or 'YYYY-MM'. */
  end: string | null;
  grade: string | null;
};

export type CareerProject = {
  id: string;
  name: string;
  url: string | null;
  /** Fact ids that describe it. */
  factIds: string[];
};

export type CareerSkill = {
  /** Normalised: lowercase, trimmed, aliases resolved (lib/career/skills.ts). */
  name: string;
  /** As the owner writes it, for display and the rendered resume. */
  label: string;
  /** Whole years of use, derived from roles and facts or set by the owner. */
  years: number | null;
};

export type CareerContact = {
  name: string;
  email: string;
  phone: string | null;
  location: string | null;
  links: Array<{ label: string; url: string }>;
};

export type CareerProfile = {
  contact: CareerContact;
  headline: string | null;
  summary: string | null;
  roles: CareerRole[];
  education: CareerEducation[];
  certifications: Array<{ id: string; name: string; issuer: string | null; year: string | null }>;
  projects: CareerProject[];
  skills: CareerSkill[];
  facts: CareerFact[];
  /** Spoken languages, for jobs that ask. */
  languages: string[];
};

// ─── Spec and settings ───────────────────────────────────────────────────

export type WorkMode = 'remote' | 'hybrid' | 'onsite';
export type Seniority = 'intern' | 'junior' | 'mid' | 'senior' | 'lead' | 'principal' | 'manager' | 'director' | 'executive';
export type SalaryPeriod = 'year' | 'month' | 'hour';

export type Money = { amount: number; currency: string; period: SalaryPeriod };

export type CareerSpec = {
  /** "Frontend engineer", "React developer"… */
  roles: string[];
  seniority: Seniority[];
  workModes: WorkMode[];
  /** Cities or countries acceptable for hybrid/onsite, and for remote eligibility. */
  locations: string[];
  /** IANA zones the owner can overlap with, for remote jobs. */
  timezones: string[];
  salaryFloor: Money | null;
  salaryTarget: Money | null;
  /** 'startup' | 'scaleup' | 'enterprise' | 'agency' | free text. */
  companyStages: string[];
  mustHaves: string[];
  /** A word here in a title, or a hard requirement here, excludes the job. */
  dealBreakers: string[];
  /** Notice period in days, used in screening answers. */
  noticeDays: number | null;
  /** Free text from the owner, for the AI's tone and context. */
  notes: string | null;
};

export const SOURCE_IDS = ['gmail_alerts', 'himalayas', 'remotive', 'remoteok', 'wwr', 'jobspresso', 'hn', 'adzuna', 'greenhouse', 'lever', 'ashby', 'recruitee', 'pasted'] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export type WatchedCompany = { ats: 'greenhouse' | 'lever' | 'ashby' | 'recruitee'; slug: string; name: string };

export type CareerSettings = {
  /** 30–90; at or above it a job is "For you" and gets a draft. */
  threshold: number;
  dailySendCap: number;
  weeklyGoal: number;
  followUpDays: number;
  ghostDays: number;
  sources: Record<SourceId, boolean>;
  watchlist: WatchedCompany[];
  /** Extra title synonyms the owner added: each group is interchangeable. */
  synonyms: string[][];
  /** Adzuna country codes ('in', 'gb', 'us'…). */
  adzunaCountries: string[];
};

export const DEFAULT_SETTINGS: CareerSettings = {
  threshold: 50,
  dailySendCap: 25,
  weeklyGoal: 15,
  followUpDays: 7,
  ghostDays: 21,
  sources: {
    gmail_alerts: true, himalayas: true, remotive: true, remoteok: true, wwr: true, jobspresso: true,
    hn: true, adzuna: true, greenhouse: true, lever: true, ashby: true, recruitee: true, pasted: true,
  },
  watchlist: [],
  synonyms: [],
  adzunaCountries: ['in'],
};

// ─── Jobs ────────────────────────────────────────────────────────────────

export type ApplyRoute = 'email' | 'recruitee' | 'link';

/** What every source parser returns. Pure data, no ids from our database. */
export type NormalizedJob = {
  source: SourceId;
  /** The source's own id for the listing, stable across fetches. */
  sourceRef: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  /** The listing page. */
  url: string;
  /** Where to apply, when different from `url`. */
  applyUrl: string | null;
  applyEmail: string | null;
  /** Plain text, capped at 20 000 chars by the parser. Null when the source gives none. */
  description: string | null;
  /** True when only a title and a line are known (job-alert emails). */
  thin: boolean;
  salary: { min: number | null; max: number | null; currency: string; period: SalaryPeriod } | null;
  postedAt: string | null;
  /** How the source must be credited on screen, e.g. 'via Remotive'. */
  attribution: string | null;
  /** For Recruitee: the offer slug and company subdomain, so Send can post to it. */
  recruitee?: { company: string; offer: string };
};

export type Requirement = { skill: string; years: number | null };

export type Requirements = {
  version: number;
  mustHave: Requirement[];
  niceToHave: Requirement[];
  minYears: number | null;
  seniority: Seniority | null;
  education: string | null;
  locationPolicy: { mode: WorkMode | null; where: string[] };
  timezones: string[];
  salary: { min: number | null; max: number | null; currency: string; period: SalaryPeriod } | null;
  employmentType: 'full_time' | 'part_time' | 'contract' | 'internship' | null;
  visa: string | null;
  applyEmail: string | null;
  screeningQuestions: string[];
};

export type RequirementVerdict = 'met' | 'partial' | 'missing';

export type MatchLine = {
  requirement: Requirement;
  kind: 'must' | 'nice';
  verdict: RequirementVerdict;
  /** Fact or role ids that back a met/partial verdict. */
  evidence: string[];
  /** Why, in one short line: "4 years at Acme and Bolt". */
  note: string;
};

export type Match = {
  score: number;
  confidence: 'high' | 'low';
  parts: { must: number; nice: number; experience: number; role: number };
  lines: MatchLine[];
  /** Set when a hard filter from the spec fails; the job is excluded whatever its score. */
  excluded: string | null;
};

export type JobState = 'new' | 'shortlisted' | 'dismissed' | 'applied';

export type CareerJob = NormalizedJob & {
  id: string;
  dedupeKey: string;
  /** Every source that listed it, newest first. */
  seenOn: Array<{ source: SourceId; url: string; attribution: string | null }>;
  requirements: Requirements | null;
  match: Match | null;
  /** Null until scored; 0 for "not your role". */
  score: number | null;
  state: JobState;
  dismissReason: string | null;
  foundAt: string;
};

// ─── Applications ────────────────────────────────────────────────────────

export const APPLICATION_STATUSES = [
  'drafting', 'ready', 'sending', 'opened', 'sent', 'acknowledged', 'replied', 'assessment', 'interview', 'offer',
  'accepted', 'declined', 'rejected', 'withdrawn', 'ghosted', 'failed',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** A bullet the AI wrote, with the facts it rests on. */
export type CitedText = { text: string; factIds: string[] };

/** The tailored content. Names, employers, titles, dates and contact come from the profile, never from here. */
export type TailoredDraft = {
  headline: string;
  summary: CitedText;
  /** Normalised skill names, in the order to show them. Each must be in the profile. */
  skills: string[];
  roles: Array<{ roleId: string; bullets: CitedText[] }>;
  projects: Array<{ projectId: string; bullets: CitedText[] }>;
};

export type ScreeningAnswer = { question: string; answer: string };

export type TruthRemoval = { where: string; text: string; reason: string };

export type AtsReport = {
  passed: boolean;
  pages: number;
  /** Share (0–1) of the job's terms found in the rendered text. */
  keywordCoverage: number;
  missingKeywords: string[];
  checks: Array<{ id: string; ok: boolean; note: string }>;
};

export type Prediction = {
  /** 0–1. */
  reply: number;
  replyRange: [number, number];
  interview: number;
  interviewRange: [number, number];
  /** True while there are too few outcomes to learn from. */
  early: boolean;
  /** Outcomes the model learned from. */
  basedOn: number;
};

export type InterviewPrep = {
  logistics: { at: string | null; format: string | null; link: string | null };
  likelyTopics: Array<{ topic: string; why: string; stories: Array<{ factId: string; prompt: string }> }>;
  questionsToAsk: string[];
  gaps: Array<{ skill: string; framing: string }>;
};

export type CareerApplication = {
  id: string;
  jobId: string;
  status: ApplicationStatus;
  route: ApplyRoute;
  draft: TailoredDraft | null;
  coverNote: CitedText | null;
  answers: ScreeningAnswer[];
  outreach: string | null;
  removed: TruthRemoval[];
  ats: AtsReport | null;
  hasPdf: boolean;
  hasDocx: boolean;
  sentAt: string | null;
  gmailThreadId: string | null;
  companyDomains: string[];
  followUpDue: string | null;
  /** A follow-up Orbis drafted when followUpDue arrived with no reply; sent only on the owner's Send. */
  followUpDraft?: string | null;
  prediction: Prediction | null;
  prep: InterviewPrep | null;
  lastEventAt: string | null;
  notes: string | null;
  updatedAt: string;
};

export const EVENT_KINDS = ['sent', 'acknowledgement', 'reply', 'recruiter_question', 'assessment', 'interview_invite', 'rejection', 'offer', 'follow_up_sent', 'status_change', 'note'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type CareerEvent = {
  id: string;
  applicationId: string | null;
  kind: EventKind;
  at: string;
  summary: string;
  details: Record<string, unknown>;
  gmailMessageId: string | null;
};

// ─── Mail ────────────────────────────────────────────────────────────────

export const REPLY_KINDS = ['acknowledgement', 'rejection', 'interview_invite', 'assessment', 'recruiter_question', 'offer', 'other'] as const;
export type ReplyKind = (typeof REPLY_KINDS)[number];

export type OfferTerms = {
  fixed: number | null;
  variable: number | null;
  joiningBonus: number | null;
  equity: string | null;
  currency: string | null;
  period: SalaryPeriod | null;
  startDate: string | null;
  deadline: string | null;
};

export type ReplyClassification = {
  kind: ReplyKind;
  company: string | null;
  role: string | null;
  interviewAt: string | null;
  interviewFormat: string | null;
  meetingLink: string | null;
  offer: OfferTerms | null;
  needsReply: boolean;
  summary: string;
};

// ─── Offers ──────────────────────────────────────────────────────────────

export type OfferAsk = { item: 'base' | 'joining_bonus' | 'notice_buyout' | 'equity' | 'remote' | 'title' | 'start_date' | 'learning_budget' | 'other'; ask: string; why: string };

export type OfferAdvice = {
  verdict: 'accept' | 'negotiate' | 'walk_away';
  reasons: string[];
  asks: OfferAsk[];
  risks: string[];
  replyDraft: string;
  /** Said aloud when the code capped the counter. */
  capNote: string | null;
};

export type CareerOffer = {
  id: string;
  applicationId: string;
  terms: OfferTerms;
  confirmed: boolean;
  advice: OfferAdvice | null;
  createdAt: string;
};

// ─── Insights ────────────────────────────────────────────────────────────

export type SkillGap = { skill: string; jobsMissingIt: number; jobsItWouldUnlock: number };
export type SalaryPulse = { currency: string; period: SalaryPeriod; p25: number; p50: number; p75: number; sample: number };

export type CareerInsights = {
  forecast: { days: 14; replies: [number, number]; interviews: [number, number]; early: boolean };
  skillGaps: SkillGap[];
  salary: SalaryPulse[];
  /** Matching jobs per ISO week, oldest first. */
  market: Array<{ week: string; jobs: number }>;
  sources: Array<{ source: SourceId; jobs: number; matches: number; applied: number; replies: number }>;
  freshness: { advice: string; fromData: boolean };
  bestDay: { day: string | null; needMore: number };
  funnel: Array<{ week: string; sent: number; replies: number; interviews: number }>;
};

// ─── What a screen loads ─────────────────────────────────────────────────

export type CareerState = {
  /** False until the migration is applied. */
  ready: boolean;
  profile: CareerProfile | null;
  spec: CareerSpec | null;
  settings: CareerSettings;
  resumeFileName: string | null;
  gmail: { connected: boolean; canSend: boolean };
  lastIngestAt: string | null;
};
