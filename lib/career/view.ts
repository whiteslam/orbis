/**
 * What the Career screens load and send. Client-safe.
 *
 * The contract between app/career/actions.ts and components/career/*: the tab
 * and the web panel both read these shapes and nothing else, so either side
 * can change without the other guessing.
 */
import type {
  ApplicationStatus, CareerApplication, CareerEvent, CareerInsights, CareerJob, CareerOffer, CareerProfile,
  CareerSettings, CareerSpec, CareerState, CitedText, OfferTerms, ScreeningAnswer, SourceId, TailoredDraft,
} from '@/lib/career/types';

export type Result<T> = { success: true; data: T } | { success: false; message: string };

/** An application with the job it's for, as every list shows it. */
export type ApplicationCard = { application: CareerApplication; job: CareerJob };

export type UpcomingInterview = ApplicationCard & { at: string | null; format: string | null; link: string | null };

export type CareerHome = {
  state: CareerState;
  counts: { forYou: number; queue: number; interviews: number; offers: number; unmatched: number };
  /** The top unapplied matches at or above the threshold, best first (at most 6). */
  hotMatches: CareerJob[];
  /** Applications waiting for the owner's Send. */
  queue: ApplicationCard[];
  /** Every application that isn't a draft, for the tracker and the pipeline board. */
  pipeline: ApplicationCard[];
  upcoming: UpcomingInterview[];
  /** Follow-ups due today or overdue. */
  followUps: ApplicationCard[];
  /** Latest events, newest first (at most 20). */
  recent: Array<CareerEvent & { company: string | null; title: string | null }>;
  unmatched: CareerEvent[];
  week: { sent: number; goal: number; sentLastWeek: number; interviews: number; replyRate: number | null };
  /** Null until there is enough to compute; Insights loads its own on demand too. */
  insights: CareerInsights | null;
};

export type JobView = 'for_you' | 'everything' | 'shortlisted';

export type JobsPage = { jobs: CareerJob[]; total: number };

export type JobFilters = { view: JobView; search?: string; source?: SourceId; remoteOnly?: boolean; minScore?: number; offset?: number };

export type ApplicationDetail = {
  job: CareerJob;
  application: CareerApplication | null;
  events: CareerEvent[];
  offer: CareerOffer | null;
  /** Signed for an hour; null until rendered. */
  files: { pdf: string | null; docx: string | null };
  /** What a link apply needs to paste, field by field. */
  pasteKit: Array<{ label: string; value: string }>;
};

export type DraftPatch = {
  coverNote?: string;
  answers?: ScreeningAnswer[];
  /** Replace one role's bullets (owner-edited text). */
  roleBullets?: { roleId: string; bullets: string[] };
  summary?: string;
};

export type SendOutcome =
  /** Sent from Gmail or posted to Recruitee. */
  | { kind: 'sent'; detail: ApplicationDetail }
  /** A link apply: open this page; the owner then presses "I applied". */
  | { kind: 'opened'; url: string; detail: ApplicationDetail }
  /** Email route without the send permission: a prefilled Gmail compose window. */
  | { kind: 'compose'; url: string; detail: ApplicationDetail };

export type ResumeUpload = { path: string; signedUrl: string; token: string };

export type CareerSetup = { profile: CareerProfile | null; spec: CareerSpec | null; settings: CareerSettings; resumeFileName: string | null };

export type OwnerMove = { to: ApplicationStatus; label: string };

export type { CitedText, OfferTerms, TailoredDraft };
