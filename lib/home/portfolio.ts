/**
 * The portfolio as the Home brief reads it: a handful of already-formatted
 * numbers, not the holdings themselves.
 *
 * Home is not the Invest tab. It says what the day did and what the portfolio
 * is worth; anything more specific belongs on the tab that can act on it.
 */
export type BriefPortfolio = {
  /** 'off' when no account is linked, so the brief says nothing rather than zero. */
  state: 'ok' | 'off';
  total: number;
  invested: number;
  holdingCount: number;
  /** Unrealised gain against cost, over positions that have a live price. */
  gain: number | null;
  /** Today's move, and how much of the portfolio actually reported one. */
  day: { value: number; percent: number; coverage: number } | null;
  largest: { name: string; share: number } | null;
};
