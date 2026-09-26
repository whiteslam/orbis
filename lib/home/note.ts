// The Home brief, as a short note rather than a row of tiles.
//
// It was a swipeable deck of tinted cards: an icon, a headline, a chip row of
// measurements, a button and a source footer, four of them side by side. That
// shape forced every true thing into the same box and made a reading of your
// morning look like a dashboard. This says it in sentences instead.
//
// Deterministic for a given day: the wording varies day to day, so it does not
// read as a template, but never re-rolls between two loads of the same screen.
import type { FinanceSummary } from '@/lib/finance/types';
import type { SourceId } from '@/lib/focus/types';
// Relative, so the unit tests can load this module under plain Node.
import { count, istParts, money } from './../focus/types.ts';
import type { BriefWeather } from '@/lib/home/weather';
import type { BriefPortfolio } from '@/lib/home/portfolio';
import type { BriefTraining } from '@/lib/home/training';
import type { RoutineToday } from '@/lib/routines/types';
import { relativeWhen } from '@/lib/routines/today';
import { clockLabel } from '@/lib/routines/types';

export type HomeNote = {
  /** Which shape matched, for tests and analytics. */
  id: string;
  /** The opening line: time of day, and the user's name when Orbis knows it. */
  greeting: string;
  /** The clock time the note was written for, in the user's timezone. */
  time: string;
  /** Which stretch of the day it speaks from, so the wording can suit it. */
  when: PartOfDay;
  /**
   * The whole brief as one paragraph — weather, training, money and investing
   * run together the way a person would say them, not filed under headings.
   * Medium length by design: long enough to be worth reading, short enough to
   * finish standing up.
   */
  caption: string;
  /** The services behind the numbers, listed once under the note. */
  sources: SourceId[];
};

export type NoteInput = {
  finance: FinanceSummary;
  weather?: BriefWeather | null;
  portfolio?: BriefPortfolio | null;
  training?: BriefTraining | null;
  /** The routine the brief should lead with, already chosen against the clock. */
  routine?: RoutineToday | null;
  /** Routines whose time passed today with nothing said about them. */
  missed?: RoutineToday[];
  name?: string | null;
  now?: Date;
};

/**
 * How many subjects the caption carries.
 *
 * Everything Orbis has an API for is a candidate (weather, training, money,
 * investing) but the caption is two sentences, not a digest of all four. The
 * subjects that need the reader come first; the rest wait for tomorrow.
 */
const MAX_SUBJECTS = 2;

/**
 * House style for everything in this file, enforced by note.test.ts:
 * British English, no em dashes, and full sentences. Em dashes in particular
 * are the tell of generated copy, so the note uses commas, semicolons and full
 * stops instead.
 */

/** Same day, same wording, so the note reads as written rather than re-rolled. */
function pick<T>(options: T[], seed: number, salt = 0) {
  return options[(seed + salt) % options.length];
}

function greet(hour: number, name: string | null, seed: number) {
  const who = name ? `, ${name}` : '';
  if (hour < 5) return pick([`Still up${who}?`, `Late one${who}.`], seed);
  if (hour < 12) return pick([`Good morning${who}.`, `Morning${who}.`], seed);
  if (hour < 17) return pick([`Good afternoon${who}.`, `Afternoon${who}.`], seed);
  if (hour < 22) return pick([`Good evening${who}.`, `Evening${who}.`], seed);
  return pick([`Winding down${who}?`, `Late one tonight${who}.`], seed);
}

/**
 * The weather, in a sentence.
 *
 * Raining and forecast to rain are different claims and a forecast names its
 * hour — the same rule the card version had to learn.
 */
function weatherLine(weather: BriefWeather, when: PartOfDay, seed: number): string | null {
  const temp = `${weather.temperature}°`;
  const feels = weather.feelsLike !== weather.temperature ? ` and feeling like ${weather.feelsLike}°` : '';
  const peak = weather.rain.peak;

  if (weather.rainingNow) {
    return `${weather.condition} out there right now, ${temp}${feels}.`;
  }
  if (peak && peak.probability >= 60) {
    return when === 'evening' || when === 'night'
      ? `Rain’s likely around ${peak.hour}, at ${peak.probability}%, so plan the morning around it.`
      : pick([
        `Rain’s likely around ${peak.hour}, at ${peak.probability}%, so move anything outdoors earlier.`,
        `Looks like rain around ${peak.hour}, at ${peak.probability}%, so keep an umbrella handy.`,
      ], seed);
  }
  if (weather.temperature >= 36) {
    return `It’s a hot one, ${temp}${feels}, so go easy in the afternoon sun.`;
  }
  if (weather.temperature <= 12) {
    return pick([`Chilly at ${temp}, so layer up.`, `It’s ${temp} out, so grab something warm.`], seed);
  }
  if (weather.weatherCode <= 1 && (!peak || peak.probability < 20)) {
    return when === 'evening' || when === 'night'
      ? `Clear out at ${temp}, so a settled night.`
      : pick([`Clear skies and ${temp}, a good day to get out for a bit.`, `${temp} and clear outside, so a nice day for a walk.`], seed);
  }
  return null;
}

/**
 * The one thing about money worth a sentence right now.
 *
 * Something waiting on the user outranks a reading of the month, and only one
 * of them makes the caption: two sentences total is the whole budget.
 */
function financeLine(finance: FinanceSummary, day: number, seed: number): string | null {
  if (finance.loadError) return 'I can’t reach your finance data at the moment, so spending and alerts are stale.';
  if (finance.connection?.status === 'reconnect_required') {
    return `Google expired access for ${finance.connection.email}, so no new bank alerts are coming in.`;
  }

  const alerts = finance.pendingCandidateCount;
  if (alerts === 1) return 'There’s one bank alert waiting on a yes or no.';
  if (alerts > 1) return `${alerts} bank alerts are waiting on a yes or no, ${alerts <= 3 ? 'a minute at most' : `about ${Math.ceil(alerts / 4)} minutes`}.`;

  const spend = finance.monthlyExpenses.length === 1 ? finance.monthlyExpenses[0] : null;
  if (spend && spend.amount > 0) {
    const perDay = spend.amount / Math.max(day, 1);
    const totals = new Map<string, number>();
    for (const transaction of finance.transactions) {
      if (transaction.direction !== 'expense' || !transaction.category) continue;
      totals.set(transaction.category, (totals.get(transaction.category) ?? 0) + transaction.amount);
    }
    const top = Array.from(totals).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
    const mostly = top ? `, mostly on ${top.toLowerCase()}` : '';
    return pick([
      `You’ve spent ${money(spend.amount, spend.currency)} so far this month, roughly ${money(perDay, spend.currency)} a day${mostly}.`,
      `Spending’s at ${money(spend.amount, spend.currency)} this month, about ${money(perDay, spend.currency)} a day${mostly}.`,
    ], seed, 2);
  }
  if (finance.monthlyExpenses.length > 1) return 'Your spending this month spans a few currencies, so the whole picture is over in Finance.';
  return null;
}


/** What today asks of you in the gym, from the plan already saved. */
/**
 * What you planned to be doing around now.
 *
 * This outranks every other subject, because it is the literal answer to the
 * question the brief exists to answer. The weather is context; a 7 pm workout
 * at 6:52 pm is the point.
 */
function routineLine(current: RoutineToday, missed: RoutineToday[]): string {
  const { routine, minutesAway } = current;
  const at = clockLabel(routine.atTime);
  const when = relativeWhen(minutesAway);
  const behind = missed.length === 1
    ? ` ${missed[0].routine.title} went by unanswered.`
    : missed.length > 1
      ? ` ${missed.length} earlier ones went by unanswered.`
      : '';

  if (minutesAway > 45) return `${routine.title} is next, at ${at}.${behind}`;
  if (minutesAway >= -10) return `${routine.title} is ${when === 'now' ? 'now' : `${when}`}, at ${at}.${behind}`;
  return `${routine.title} was ${when}, at ${at}.${behind}`;
}

function trainingLine(training: BriefTraining, when: PartOfDay, seed: number): string | null {
  if (training.state !== 'ok' || !training.today) return null;
  const { focus, rest, durationMinutes } = training.today;
  const session = focus.trim().toLowerCase();

  if (rest) {
    return when === 'evening' || when === 'night'
      ? `Rest day on ${training.planTitle}, so nothing owed at the gym tonight.`
      : pick([`Today’s a rest day, so a walk is plenty.`, `${training.planTitle} has you resting today.`], seed, 5);
  }

  // The movements themselves live in the plan. Naming them here costs a third
  // of the caption to say what one tap already shows.
  const how = durationMinutes ? `, about ${durationMinutes} minutes` : '';
  if (when === 'night') return `If ${session} didn’t happen today, tomorrow’s the better fight.`;
  if (when === 'evening') return `${focus} is still on today’s card${how} if you haven’t got to it.`;
  if (when === 'afternoon') return `${focus} is what today asks for${how}, and there’s still time.`;
  return pick([`Gym today is ${session}${how}.`, `You’re down for ${session} today${how}.`], seed, 6);
}


/**
 * The only setup worth a sentence here is the one that makes the rest of the
 * note possible. Asking for a file upload is a Health-tab errand, not something
 * to greet someone with.
 */
function setupLines(finance: FinanceSummary, when: string, seed: number): string[] {
  if (!finance.databaseReady || finance.connection) return [];
  return [pick([
    `Connect Gmail and I can start tracking your expenses ${when}. It’s read-only, bank alerts only, never the message body.`,
    `If you connect Gmail I’ll pick up your bank alerts from ${when} on. It’s read-only and one tap to undo.`,
  ], seed, 4)];
}

function portfolioLine(portfolio: BriefPortfolio, seed: number): string | null {
  if (portfolio.state !== 'ok' || portfolio.total <= 0) return null;
  const day = portfolio.day && portfolio.day.coverage >= 0.6 ? portfolio.day : null;

  if (day) {
    // A day drawn from part of the holdings still says which part; that is the
    // difference between a true number and a wrong one, not a detail.
    const partial = day.coverage < 0.99 ? `, going on the ${Math.round(day.coverage * 100)}% of it that’s priced live` : '';
    return pick([
      `Your portfolio’s ${day.value >= 0 ? 'up' : 'down'} ${money(Math.abs(day.value))} today${partial}, ${Math.abs(day.percent).toFixed(1)}%.`,
      `Investments are ${day.value >= 0 ? 'up' : 'down'} ${Math.abs(day.percent).toFixed(1)}% on the day${partial}.`,
    ], seed, 3);
  }
  return `Your portfolio sits at ${money(portfolio.total)} across ${count(portfolio.holdingCount, 'holding')}.`;
}

/**
 * The stretch of day the note speaks from.
 *
 * It is not only a greeting: a workout is something to plan at 7am and
 * something you have probably missed at 9pm, and after dark the weather that
 * matters is tonight rather than the day ahead. Each line reads this before it
 * chooses its words.
 */
export type PartOfDay = 'early' | 'morning' | 'afternoon' | 'evening' | 'night';

export function partOfDay(hour: number): PartOfDay {
  if (hour < 5) return 'early';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'night';
}

const AHEAD: Record<PartOfDay, string> = {
  early: 'later today',
  morning: 'this morning',
  afternoon: 'this afternoon',
  evening: 'this evening',
  night: 'tomorrow',
};

function clock(now: Date) {
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TIME_ZONE })
    .format(now)
    .replace(/\s?([ap])m$/i, (_match, half: string) => ` ${half.toLowerCase()}m`);
}

const TIME_ZONE = 'Asia/Kolkata';

export function composeNote(input: NoteInput): HomeNote {
  const now = input.now ?? new Date();
  const today = istParts(now);
  const seed = today.year * 400 + today.month * 32 + today.day;
  const firstName = input.name?.trim().split(/\s+/)[0] || null;
  const when = partOfDay(today.hour);

  // Subjects in the order a person would raise them: what is happening outside,
  // what today asks of you, then the money. Each carries the service behind it
  // so the credits below list what the caption kept, not what it considered.
  const candidates: Array<{ text: string; from: SourceId }> = [];

  const scheduled = input.routine ? routineLine(input.routine, input.missed ?? []) : null;
  if (scheduled) candidates.push({ text: scheduled, from: 'orbis' });

  const sky = input.weather ? weatherLine(input.weather, when, seed) : null;
  if (sky) candidates.push({ text: sky, from: 'open-meteo' });

  // The plan's session only speaks when no routine already covers the gym, or
  // the brief says the same thing twice in two sentences.
  const covered = input.routine?.routine.kind === 'workout';
  const gym = !covered && input.training ? trainingLine(input.training, when, seed) : null;
  if (gym) candidates.push({ text: gym, from: 'orbis' });

  const cash = financeLine(input.finance, today.day, seed);
  if (cash) candidates.push({ text: cash, from: input.finance.connection ? 'gmail' : 'orbis' });

  const investing = input.portfolio ? portfolioLine(input.portfolio, seed) : null;
  if (investing) candidates.push({ text: investing, from: 'groww' });

  const kept = candidates.slice(0, MAX_SUBJECTS);
  const sources = new Set<SourceId>(kept.map((subject) => subject.from));

  // A setup suggestion only speaks when there was nothing truer to say.
  if (!kept.length) {
    const setup = setupLines(input.finance, AHEAD[when], seed);
    if (setup.length) {
      return { id: 'setup', greeting: greet(today.hour, firstName, seed), time: clock(now), when, caption: setup[0], sources: ['orbis'] };
    }
    return {
      id: 'quiet',
      greeting: greet(today.hour, firstName, seed),
      time: clock(now),
      when,
      caption: 'Nothing needs you right now. No alerts, nothing waiting in Finance or Health. I’ll say something when that changes.',
      sources: ['orbis'],
    };
  }

  return {
    id: scheduled ? 'routine-first' : sky ? 'weather-first' : gym ? 'training-first' : cash ? 'money-first' : 'investing-first',
    greeting: greet(today.hour, firstName, seed),
    time: clock(now),
    when,
    // Sources are listed for what the caption actually kept, not for every
    // reading that was considered and cut.
    caption: kept.map((subject) => subject.text).join(' '),
    sources: Array.from(sources),
  };
}
