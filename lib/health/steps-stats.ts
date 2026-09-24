export type DayRow = { date: string; steps: number };

const DAY_MS = 86_400_000;

// Average over the days that have data in the `span` calendar days ending at `endDate` (inclusive).
export function averageSteps(days: DayRow[], endDate: string, span: number, offset = 0) {
  const end = Date.parse(`${endDate}T00:00:00Z`) - offset * DAY_MS;
  const start = end - (span - 1) * DAY_MS;
  const inRange = days.filter((day) => {
    const time = Date.parse(`${day.date}T00:00:00Z`);
    return time >= start && time <= end;
  });
  return inRange.length ? Math.round(inRange.reduce((sum, day) => sum + day.steps, 0) / inRange.length) : null;
}

// Windows end at the latest imported day, not today: an export can be days or weeks old.
export function stepStats(days: DayRow[]) {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted.at(-1) ?? null;
  if (!latest) return { latest: null, average7: null, average30: null, average90: null, previous30: null, best: null };
  const recent = sorted.filter((day) => Date.parse(`${day.date}T00:00:00Z`) > Date.parse(`${latest.date}T00:00:00Z`) - 90 * DAY_MS);
  return {
    latest,
    average7: averageSteps(sorted, latest.date, 7),
    average30: averageSteps(sorted, latest.date, 30),
    average90: averageSteps(sorted, latest.date, 90),
    previous30: averageSteps(sorted, latest.date, 30, 30),
    best: recent.reduce<DayRow | null>((best, day) => (!best || day.steps > best.steps ? day : best), null),
  };
}

// Bounded step summary for AI advice: averages, a 30-day trend and the most recent fortnight.
export function stepContext(days: DayRow[]) {
  const stats = stepStats(days);
  const trend = stats.average30 !== null && stats.previous30 ? Math.round(((stats.average30 - stats.previous30) / stats.previous30) * 100) : null;
  return {
    latestDate: stats.latest?.date ?? null,
    average7: stats.average7,
    average30: stats.average30,
    average90: stats.average90,
    trendVsPrevious30: trend === null ? null : `${trend >= 0 ? '+' : ''}${trend}%`,
    last14Days: [...days].sort((a, b) => a.date.localeCompare(b.date)).slice(-14),
  };
}
