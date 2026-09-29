/** Today's widgets. Pure: shaping summary data the widgets draw. */

/** The last `count` days of this month up to `today`, each with its share of the largest day. */
export function recentDays(daily: Array<{ day: number; amount: number }>, today: number, count = 6) {
  const byDay = new Map(daily.map((entry) => [entry.day, entry.amount]));
  const first = Math.max(1, today - count + 1);
  const days = Array.from({ length: today - first + 1 }, (_, index) => ({ day: first + index, amount: byDay.get(first + index) ?? 0 }));
  const max = Math.max(0, ...days.map((entry) => entry.amount));
  return days.map((entry) => ({ ...entry, share: max > 0 ? entry.amount / max : 0 }));
}
