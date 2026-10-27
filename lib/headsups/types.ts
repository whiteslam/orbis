// Heads-ups: what Orbis noticed, and the one step it has ready. Client-safe.

/** What the daily scan checks for (lib/headsups/scan.ts). */
export const SCAN_KINDS = [
  'money.big_spend',
  'money.category_hot',
  'money.logging_gap',
  'routine.slipping',
  'health.steps_down',
  'health.plan_finished',
] as const;

/**
 * Raised by the career watcher as mail arrives, not by the daily scan, so the
 * scan must never withdraw them as stale.
 */
export const CAREER_KINDS = ['career.interview', 'career.offer', 'career.question', 'career.follow_up'] as const;

/**
 * Raised by the Research desk's Monday cron (app/api/research/weekly), and only
 * for the desk's owner, so the scan never withdraws them and Settings doesn't
 * list them for everyone: the owner turns the weekly run off in the desk.
 */
export const RESEARCH_KINDS = ['money.research_week'] as const;

export const HEADSUP_KINDS = [...SCAN_KINDS, ...CAREER_KINDS, ...RESEARCH_KINDS] as const;
export type HeadsupKind = (typeof HEADSUP_KINDS)[number];

/** The checks Settings offers to turn off: everything but the owner-only desk's. */
export const SETTINGS_KINDS: readonly HeadsupKind[] = HEADSUP_KINDS.filter((kind) => !(RESEARCH_KINDS as readonly string[]).includes(kind));

/** How Settings names each check. */
export const KIND_LABELS: Record<HeadsupKind, string> = {
  'money.big_spend': 'A spend much bigger than usual',
  'money.category_hot': 'A category running ahead of its usual month',
  'money.logging_gap': 'Days with no spending logged',
  'routine.slipping': 'A routine missed several times in a row',
  'health.steps_down': 'Steps well below your usual',
  'health.plan_finished': 'A health plan that has finished',
  'career.interview': 'An interview invite for a job you applied to',
  'career.offer': 'A job offer',
  'career.question': 'A recruiter asking you something',
  'career.follow_up': 'A follow-up ready for an application with no reply',
  'money.research_week': 'The weekend’s Research desk calls',
};

/** Fixed in code: the model words a heads-up, it never decides how loud it is. */
export const URGENCY: Record<HeadsupKind, 'normal' | 'urgent'> = {
  'money.big_spend': 'urgent',
  'money.category_hot': 'normal',
  'money.logging_gap': 'normal',
  'routine.slipping': 'urgent',
  'health.steps_down': 'normal',
  'health.plan_finished': 'normal',
  'career.interview': 'urgent',
  'career.offer': 'urgent',
  'career.question': 'urgent',
  'career.follow_up': 'normal',
  'money.research_week': 'normal',
};

export type HeadsupAction =
  | { type: 'open_spending_entry'; category?: string }
  | { type: 'review_category'; category: string }
  | { type: 'adjust_routine'; routineId: string }
  | { type: 'open_health_plan'; planId: string }
  | { type: 'open_steps' }
  | { type: 'open_career_application'; applicationId: string }
  | { type: 'open_research' };

export type Evidence = Record<string, string | number>;

export type Wording = { title: string; body: string; actionLabel: string };

export type Finding = {
  kind: HeadsupKind;
  dedupeKey: string;
  urgency: 'normal' | 'urgent';
  evidence: Evidence;
  action: HeadsupAction;
  fallback: Wording;
};

/** What Today renders. */
export type Headsup = {
  id: string;
  kind: HeadsupKind;
  urgency: 'normal' | 'urgent';
  title: string;
  body: string;
  action: HeadsupAction;
  actionLabel: string;
  wordedBy: 'ai' | 'rules';
  createdAt: string;
};

export function isHeadsupKind(value: unknown): value is HeadsupKind {
  return typeof value === 'string' && (HEADSUP_KINDS as readonly string[]).includes(value);
}

const text = (value: unknown, max = 120) => typeof value === 'string' && value.length > 0 && value.length <= max;

/** An action read back from the database, or null if it is not one Orbis knows. */
export function parseAction(value: unknown): HeadsupAction | null {
  if (!value || typeof value !== 'object') return null;
  const action = value as Record<string, unknown>;
  switch (action.type) {
    case 'open_spending_entry':
      if (action.category === undefined) return { type: 'open_spending_entry' };
      return text(action.category) ? { type: 'open_spending_entry', category: action.category as string } : null;
    case 'review_category':
      return text(action.category) ? { type: 'review_category', category: action.category as string } : null;
    case 'adjust_routine':
      return text(action.routineId, 64) ? { type: 'adjust_routine', routineId: action.routineId as string } : null;
    case 'open_health_plan':
      return text(action.planId, 64) ? { type: 'open_health_plan', planId: action.planId as string } : null;
    case 'open_steps':
      return { type: 'open_steps' };
    case 'open_career_application':
      return text(action.applicationId, 64) ? { type: 'open_career_application', applicationId: action.applicationId as string } : null;
    case 'open_research':
      return { type: 'open_research' };
    default:
      return null;
  }
}

export type HeadsupsResponse = { state: 'ready' | 'setup'; headsups: Headsup[]; disabledKinds: HeadsupKind[]; offerOff: HeadsupKind[] };
