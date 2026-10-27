// What the Research desk's screens receive from its server actions. Client-safe.

import type { ResearchEvent, ResearchRun, ResearchSettings, ResearchSettlement } from '@/lib/research/types';

export type Result<T> = { success: true; data: T } | { success: false; message: string };

export type ResearchDesk = {
  runs: ResearchRun[];
  settlements: ResearchSettlement[];
  settings: ResearchSettings;
  /** The worker's GitHub token and repo are set on this server. */
  configured: boolean;
  /** Runs started this month (India), against settings.monthlyRunCap. */
  monthUsed: number;
};

export type RunDetail = {
  run: ResearchRun;
  /** Only the events after the `afterSeq` asked for. */
  events: ResearchEvent[];
  settlement: ResearchSettlement | null;
};
