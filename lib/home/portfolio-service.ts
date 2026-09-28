import 'server-only';

import { analysePortfolio } from '@/lib/invest/analysis';
import { loadLivePortfolio } from '@/lib/invest/live';
import type { BriefPortfolio } from '@/lib/home/portfolio';

const OFF: BriefPortfolio = { state: 'off', total: 0, invested: 0, holdingCount: 0, gain: null, day: null, largest: null };

/**
 * The portfolio reduced to what the Home brief says about it.
 *
 * Home asks for this on every visit, so it returns the small shape rather than
 * every holding, and reports 'off' instead of zeros when nothing is linked.
 * The caller has already established who `userId` is and that the app is unlocked.
 */
export async function loadBriefPortfolio(userId: string, email: string | null): Promise<BriefPortfolio> {
  const live = await loadLivePortfolio(userId, email);
  if (!live.brokers.some((broker) => broker.state === 'ok')) return OFF;
  const analysis = analysePortfolio(live.brokers);
  if (!analysis.positions.length) return OFF;

  return {
    state: 'ok',
    total: analysis.total,
    invested: analysis.invested,
    holdingCount: analysis.positions.length,
    gain: analysis.livePnl,
    day: analysis.dayChange,
    largest: analysis.largest,
  };
}
