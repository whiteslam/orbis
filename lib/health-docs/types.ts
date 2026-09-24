export type HealthDocument = {
  id: string;
  fileName: string;
  kind: 'pdf' | 'xlsx';
  sizeBytes: number;
  hasOriginal: boolean;
  chunkCount: number;
  createdAt: string;
  /** Read into every plan, rather than only when a search surfaces it. */
  alwaysInclude: boolean;
};

export type PlanQuestion = {
  id: string;
  question: string;
  why: string;
  kind: 'single' | 'multi' | 'text' | 'number';
  options: string[];
  unit: string | null;
};

export type PlanAnswer = { id: string; question: string; answer: string };

export type WorkoutDay = {
  day: string;
  focus: string;
  rest: boolean;
  durationMinutes: number | null;
  exercises: Array<{ name: string; sets: string | null; reps: string | null; duration: string | null; notes: string | null }>;
};

export type TargetSeries = {
  metric: string;
  unit: string;
  points: Array<{ week: number; value: number }>;
};

export type HealthPlan = {
  title: string;
  summary: string;
  durationWeeks: number;
  workout: { overview: string; week: WorkoutDay[]; progression: string };
  nutrition: { overview: string; dailyTargets: Array<{ label: string; value: string }>; meals: Array<{ meal: string; ideas: string }>; tips: string[] };
  targets: TargetSeries[];
  milestones: Array<{ week: number; title: string; detail: string }>;
  sleep: { bedtime: string; wakeTime: string; targetHours: number; habits: string[]; recovery: string[] };
  cautions: string[];
  sources: string[];
};

export type HealthPlanRecord = { id: string; title: string; plan: HealthPlan; createdAt: string };
