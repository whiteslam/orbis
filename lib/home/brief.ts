// Builds the Home brief as a short, conversational note from Orbis.
// Deterministic for a given day, so wording varies day to day but never flickers.
import type { FinanceSummary } from '@/lib/finance/types';
import type { GoalsSummary } from '@/lib/goals/types';

const TIME_ZONE = 'Asia/Kolkata';

function istParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23' }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') };
}

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString('en-IN')}`;
  }
}

function pick<T>(options: T[], seed: number) {
  return options[seed % options.length];
}

function greeting(hour: number, name: string | null, seed: number) {
  const who = name ? `, ${name}` : '';
  if (hour < 5) return `Still up${who}?`;
  if (hour < 12) return pick([`Good morning${who}.`, `Morning${who}.`], seed);
  if (hour < 17) return pick([`Good afternoon${who}.`, `Hey${who}, hope the day’s going well.`], seed);
  if (hour < 22) return pick([`Good evening${who}.`, `Evening${who}.`], seed);
  return pick([`Winding down${who}?`, `Late one tonight${who}.`], seed);
}

export type BriefWeather = { temperature: number; rainProbability: number; condition: string; weatherCode: number };

function weatherLine(weather: BriefWeather, seed: number) {
  const temp = `${weather.temperature}°`;
  if (weather.weatherCode >= 95) return `Thunderstorms around today, so plan indoor stuff if you can.`;
  if (weather.rainProbability >= 60) return pick([`Looks like rain later (${weather.rainProbability}% chance), so keep an umbrella handy.`, `There’s a ${weather.rainProbability}% chance of rain today, worth carrying an umbrella.`], seed);
  if (weather.temperature >= 36) return pick([`It’s a hot one, ${temp} out there. Drink plenty of water.`, `${temp} outside today, so go easy in the afternoon sun.`], seed);
  if (weather.temperature <= 12) return pick([`Chilly today at ${temp}, so layer up.`, `It’s ${temp} out, grab something warm.`], seed);
  if (weather.weatherCode <= 1 && weather.rainProbability < 20) return pick([`Clear skies and ${temp}, nice day to get some steps in.`, `${temp} and clear outside. Good day for a walk.`], seed);
  return null;
}

export function composeBrief({ finance, goals, name, weather, now = new Date() }: { finance: FinanceSummary; goals: GoalsSummary; name: string | null; weather?: BriefWeather | null; now?: Date }) {
  const today = istParts(now);
  const seed = today.year * 400 + today.month * 32 + today.day;
  const lines: string[] = [];

  // 1. Anything waiting on the user comes first.
  const alerts = finance.pendingCandidateCount;
  if (alerts > 0) {
    lines.push(alerts === 1
      ? pick(['One bank alert came in that I haven’t logged yet. Have a quick look when you get a sec.', 'There’s a bank alert waiting for you to confirm, it’ll only take a moment.'], seed)
      : pick([`${alerts} bank alerts are waiting for you to confirm. Should only take a couple of minutes.`, `I’ve got ${alerts} bank alerts lined up for you to check whenever you’re free.`], seed));
  }

  // 2. Spending so far this month.
  const spend = finance.monthlyExpenses.length === 1 ? finance.monthlyExpenses[0] : null;
  if (spend && spend.amount > 0) {
    const perDay = spend.amount / Math.max(today.day, 1);
    const topCategory = (() => {
      const totals = new Map<string, number>();
      for (const transaction of finance.transactions) {
        const when = istParts(new Date(transaction.occurredAt));
        if (transaction.direction !== 'expense' || !transaction.category || when.year !== today.year || when.month !== today.month) continue;
        totals.set(transaction.category, (totals.get(transaction.category) ?? 0) + transaction.amount);
      }
      return Array.from(totals).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
    })();
    const base = pick([
      `You’ve spent ${money(spend.amount, spend.currency)} so far this month, roughly ${money(perDay, spend.currency)} a day.`,
      `So far this month you’re at ${money(spend.amount, spend.currency)} in spending, about ${money(perDay, spend.currency)} a day.`,
    ], seed);
    lines.push(topCategory ? `${base} ${topCategory} is taking the biggest share.` : base);
  } else if (finance.monthlyExpenses.length > 1) {
    lines.push('Your spending this month is spread across a few currencies, so the full picture is in Finance.');
  } else if (finance.databaseReady && !finance.loadError) {
    lines.push(pick(['Nothing logged for spending this month yet. If you’ve paid for anything, jot it down in Finance and I’ll keep count.', 'I haven’t seen any spending this month. Add expenses as they happen and I’ll keep the tally for you.'], seed));
  }

  // 3. The goal that most needs attention: the nearest deadline, otherwise the most recent.
  const openGoals = goals.goals.filter((goal) => goal.target > 0);
  const focus = openGoals
    .filter((goal) => goal.current < goal.target && goal.dueDate)
    .sort((left, right) => (left.dueDate ?? '').localeCompare(right.dueDate ?? ''))[0]
    ?? openGoals.find((goal) => goal.current < goal.target)
    ?? openGoals[0];
  if (focus) {
    const progress = Math.min(100, Math.round((focus.current / focus.target) * 100));
    const todayKey = `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;
    const daysLeft = focus.dueDate ? Math.round((Date.parse(`${focus.dueDate}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 86_400_000) : null;
    if (progress >= 100) {
      lines.push(`You hit “${focus.title}”. Nice work, that one’s done.`);
    } else if (daysLeft !== null && daysLeft < 0) {
      lines.push(`“${focus.title}” went past its date at ${progress}%. Want to set a new date, or keep pushing?`);
    } else if (daysLeft !== null && daysLeft <= 30) {
      lines.push(`You’re ${progress}% of the way to “${focus.title}”, with ${daysLeft === 0 ? 'today as the deadline' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} to go`}.`);
    } else if (progress === 0) {
      lines.push(pick([`“${focus.title}” hasn’t moved yet. Even a small first step today counts.`, `Haven’t started on “${focus.title}” yet. No pressure, just a nudge.`], seed));
    } else {
      lines.push(pick([`You’re ${progress}% of the way to “${focus.title}”. Steady progress.`, `“${focus.title}” is at ${progress}%. Keep it going.`], seed));
    }
  } else if (goals.databaseReady && lines.length < 2) {
    lines.push('If there’s something you’re working toward, add it as a goal in Health and I’ll keep an eye on it for you.');
  }

  // Weather comes right after the greeting when it is worth mentioning.
  const sky = weather ? weatherLine(weather, seed) : null;
  if (sky) lines.unshift(sky);

  if (!lines.length) {
    return `${greeting(today.hour, name, seed)} It’s quiet around here for now. Log an expense or set a goal, and I’ll start keeping you posted.`;
  }
  return [greeting(today.hour, name, seed), ...lines.slice(0, 3)].join(' ');
}
