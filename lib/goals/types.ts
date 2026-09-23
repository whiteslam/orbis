export type GoalSummary = {
  id: string;
  title: string;
  current: number;
  target: number;
  unit: string;
  dueDate: string | null;
};

export type HabitSummary = {
  id: string;
  title: string;
  checkedToday: boolean;
  streak: number;
};

export type GoalsSummary = {
  databaseReady: boolean;
  goals: GoalSummary[];
  habits: HabitSummary[];
};
