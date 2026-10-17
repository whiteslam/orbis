// What the Invest tab leads with. The portfolio total is always on screen, so
// the focal surface spends its words on what the total does not tell you:
// concentration, whether the numbers are live, and what moved.

import type { PortfolioAnalysis } from '@/lib/invest/analysis';
import type { Focus, QuietRow } from '@/lib/focus/types';
// Relative, so the unit tests can load this module under plain Node.
import { count, money, percent, shortDate } from './types.ts';

export type InvestFocusInput = {
  analysis: PortfolioAnalysis;
  /** False until the first load of the connected accounts has come back. */
  loaded: boolean;
  /** Accounts that answered with an error, and what they said. */
  failures: Array<{ name: string; message: string }>;
  /** True once at least one account is linked, connected or not yet syncing. */
  connected: boolean;
  savedAdviceAt?: string | null;
};

function failureFocus(failures: InvestFocusInput['failures']): Focus {
  const [first] = failures;
  const others = failures.length > 1 ? `${count(failures.length - 1, 'other account')} also failed. ` : '';
  return {
    id: 'account-error',
    headline: `${first.name} could not be reached.`,
    body: `${first.message} Nothing about your portfolio has changed — only Orbis's view of it. ${others}Try syncing again below.`,
    action: null,
  };
}

/** The total, said in terms of live gain or loss when there is a live price, else cost. */
function positionsFocus(analysis: PortfolioAnalysis, savedAdviceAt: string | null | undefined): Focus {
  const top = analysis.byClass.slice().sort((left, right) => right.value - left.value)[0];
  const mostly = top ? ` Mostly ${top.assetClass.toLowerCase()} at ${percent(top.share)}.` : '';
  const saved = savedAdviceAt ? ` Suggestions saved ${shortDate(savedAdviceAt)}.` : '';
  const headline = `${money(analysis.total)} across ${count(analysis.positions.length, 'holding')}.`;
  if (analysis.livePnl !== null && analysis.liveInvested > 0) {
    const up = analysis.livePnl >= 0;
    const change = percent(Math.abs(analysis.livePnl / analysis.liveInvested));
    const unpriced = analysis.allLive ? '' : ' Holdings without a live price count at what they cost.';
    return {
      id: 'live-position',
      headline,
      body: `Positions with a live price are ${up ? 'up' : 'down'} ${money(Math.abs(analysis.livePnl))} on what you paid, ${change} ${up ? 'ahead' : 'behind'}.${mostly}${unpriced}${saved}`,
      action: null,
    };
  }

  return {
    id: 'cost-basis',
    headline,
    body: `No live price came back for these, so the total is what they cost rather than what the market says today.${mostly}${saved}`,
    action: null,
  };
}

function signedMoney(value: number) {
  return `${value >= 0 ? '+' : '−'}${money(Math.abs(value))}`;
}

export function composeInvestFocus({ analysis, loaded, failures, connected, savedAdviceAt }: InvestFocusInput): Focus {
  // Holdings arrive from the broker after the page renders, so an empty screen
  // during that first fetch must not read as "you own nothing".
  if (!loaded) {
    return {
      id: 'loading',
      headline: 'Reading your accounts.',
      body: 'Holdings and prices are being pulled from every account you have connected. This takes a moment on a cold start.',
      action: null,
    };
  }

  if (failures.length) return failureFocus(failures);

  if (!connected) {
    return {
      id: 'not-connected',
      headline: 'Connect an account and this screen starts working.',
      body: 'Orbis reads your holdings directly from the broker — read-only, no orders — and prices them from AMFI and the exchanges. Nothing to type in, and nothing to keep up to date by hand.',
      action: null,
    };
  }

  if (!analysis.positions.length) {
    return {
      id: 'no-holdings',
      headline: 'Connected, but nothing to show yet.',
      body: 'The account is linked and answering, and it reports no holdings. Anything you buy will appear here on the next sync.',
      action: null,
    };
  }

  const largest = analysis.largest;
  if (largest && largest.share >= 0.4) {
    return {
      id: 'concentration',
      headline: `${largest.name} is ${percent(largest.share)} of everything you hold.`,
      body: `Of ${money(analysis.total)} across ${count(analysis.positions.length, 'holding')}, which behave like about ${analysis.effectiveHoldings.toFixed(1)} independent ones — so a bad month for this single position is a bad month for the whole portfolio.`,
      action: null,
    };
  }

  return positionsFocus(analysis, savedAdviceAt);
}

export function composeInvestRows({ analysis }: { analysis: PortfolioAnalysis }): QuietRow[] {
  const top = analysis.byClass.slice().sort((left, right) => right.value - left.value)[0] ?? null;
  const empty = analysis.positions.length === 0;
  // The total is the screen's hero figure now, so it is not repeated here.
  return [
    { label: 'Invested', value: empty ? '—' : money(analysis.invested), empty, target: null },
    { label: 'Unrealised', value: analysis.livePnl === null ? 'No live prices' : signedMoney(analysis.livePnl), empty: analysis.livePnl === null, target: null },
    { label: 'Holdings', value: empty ? 'None' : String(analysis.positions.length), empty, target: null },
    { label: 'Largest position', value: analysis.largest ? `${analysis.largest.name} · ${percent(analysis.largest.share)}` : 'None', empty: !analysis.largest, target: null },
    { label: 'Mostly', value: top ? `${top.assetClass} · ${percent(top.share)}` : 'None', empty: !top, target: null },
  ];
}
