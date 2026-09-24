export type StepsSummary = {
  databaseReady: boolean;
  loadError: boolean;
  days: { date: string; steps: number }[];
  latest: { date: string; steps: number } | null;
  average7: number | null;
  average30: number | null;
  previous30: number | null;
  best: { date: string; steps: number } | null;
  lastImport: { importedAt: string; lastDate: string | null } | null;
};
