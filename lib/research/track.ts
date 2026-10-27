// How past calls did, shown beside every decision so the desk is judged on
// evidence rather than on how sure it sounds. Client-safe and pure.

import type { ResearchSettlement } from '@/lib/research/types';

export type TrackRecord = { count: number; beat: number; averageAlpha: number | null; line: string };

export const TRACK_WINDOW = 12;

const signed = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}%`;

/** The last 12 settled calls, newest first by decision date. */
export function trackRecord(settlements: readonly ResearchSettlement[]): TrackRecord {
  const recent = [...settlements].sort((left, right) => right.tradeDate.localeCompare(left.tradeDate)).slice(0, TRACK_WINDOW);
  if (!recent.length) {
    return { count: 0, beat: 0, averageAlpha: null, line: 'No calls settled yet. Each call is scored against Nifty five trading days after its date.' };
  }
  const beat = recent.filter((item) => item.alphaPct > 0).length;
  const averageAlpha = Math.round((recent.reduce((sum, item) => sum + item.alphaPct, 0) / recent.length) * 10) / 10;
  const benchmarks = new Set(recent.map((item) => item.benchmark));
  const against = benchmarks.size > 1 ? 'the index' : benchmarks.has('^BSESN') ? 'Sensex' : 'Nifty';
  const line = recent.length === 1
    ? `Last call: ${beat ? 'beat' : 'did not beat'} ${against}, alpha ${signed(averageAlpha)}.`
    : `Last ${recent.length} calls: ${beat} beat ${against}, average alpha ${signed(averageAlpha)}.`;
  return { count: recent.length, beat, averageAlpha, line };
}
