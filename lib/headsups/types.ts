// Heads-ups: what Orbis noticed, and the one step it has ready. Client-safe.

export const HEADSUP_KINDS = [
  'money.big_spend',
  'money.category_hot',
  'money.logging_gap',
  'routine.slipping',
  'health.steps_down',
  'health.plan_finished',
] as const;
export type HeadsupKind = (typeof HEADSUP_KINDS)[number];

/** How Settings names each check. */
export const KIND_LABELS: Record<HeadsupKind, string> = {
  'money.big_spend': 'A spend much bigger than usual',
  'money.category_hot': 'A category running ahead of its usual month',
  'money.logging_gap': 'Days with no spending logged',
  'routine.slipping': 'A routine missed several times in a row',
  'health.steps_down': 'Steps well below your usual',
  'health.plan_finished': 'A health plan that has finished',
};

/** Fixed in code: the model words a heads-up, it never decides how loud it is. */
export const URGENCY: Record<HeadsupKind, 'normal' | 'urgent'> = {
  'money.big_spend': 'urgent',
  'money.category_hot': 'normal',
  'money.logging_gap': 'normal',
  'routine.slipping': 'urgent',
  'health.steps_down': 'normal',
  'health.plan_finished': 'normal',
};

export type HeadsupAction =
  | { type: 'open_spending_entry'; category?: string }
  | { type: 'review_category'; category: string }
  | { type: 'adjust_routine'; routineId: string }
  | { type: 'open_health_plan'; planId: string }
  | { type: 'open_steps' };

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
    default:
      return null;
  }
}
