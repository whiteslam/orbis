import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeNote } from './note.ts';
import type { FinanceSummary } from '../finance/types.ts';
import type { BriefWeather } from './weather.ts';
import type { BriefPortfolio } from './portfolio.ts';
import type { BriefTraining } from './training.ts';

const NOW = new Date('2026-09-24T14:30:00Z'); // 8pm IST on the 24th

const finance = (over: Partial<FinanceSummary> = {}): FinanceSummary => ({
  databaseReady: true,
  loadError: false,
  connection: { email: 'you@example.com', status: 'connected', lastSyncAt: null },
  pendingCandidateCount: 0,
  unparsedCandidateCount: 0,
  reviewCandidates: [],
  transactions: [],
  monthlyExpenses: [],
  month: null,
  ...over,
} as FinanceSummary);

const weather = (over: Partial<BriefWeather> = {}): BriefWeather => ({
  temperature: 26, feelsLike: 26, humidity: 50, windSpeed: 8,
  condition: 'Partly cloudy', weatherCode: 2, isDay: true,
  rainingNow: false, rain: { soon: 0, peak: null }, ...over,
});

const portfolio = (over: Partial<BriefPortfolio> = {}): BriefPortfolio => ({
  state: 'ok', total: 482_300, invested: 443_400, holdingCount: 11,
  gain: 38_900, day: null, largest: { name: 'HDFCBANK', share: 0.31 },
  ...over,
});

const training = (over: Partial<BriefTraining> = {}): BriefTraining => ({
  state: 'ok', planTitle: 'Twelve-week rebuild',
  today: { focus: 'Upper body', rest: false, durationMinutes: 45, exercises: ['Bench press', 'Rows', 'Curls'] }, ...over,
});

const settled = (over: Partial<Parameters<typeof composeNote>[0]> = {}) =>
  composeNote({ finance: finance(), now: NOW, ...over });

const text = (note: ReturnType<typeof composeNote>) => note.caption;
const raining = weather({ rainingNow: true, condition: 'Rain showers', weatherCode: 80, rain: { soon: 90, peak: { probability: 90, hour: '11 pm' } } });

test('the note opens by greeting the hour, and the person when it knows them', () => {
  assert.match(settled().greeting, /[Ee]vening/);
  assert.match(settled({ name: 'Rahul Chandrakar' }).greeting, /Rahul\b/);
  assert.ok(!settled({ name: 'Rahul Chandrakar' }).greeting.includes('Chandrakar'), 'first name only');
  assert.match(composeNote({ finance: finance(), now: new Date('2026-09-24T02:30:00Z') }).greeting, /[Mm]orning/);
});

test('the wording holds within a stretch of the day rather than re-rolling', () => {
  const spend = finance({ monthlyExpenses: [{ currency: 'INR', amount: 24_000 }] });
  const nine = composeNote({ finance: spend, now: new Date('2026-09-24T03:30:00Z') });
  const eleven = composeNote({ finance: spend, now: new Date('2026-09-24T05:30:00Z') });
  assert.equal(nine.caption, eleven.caption, 'same morning, same note');
});

test('it reads as sentences, never as a card stripped of its box', () => {
  const note = settled({
    finance: finance({ pendingCandidateCount: 2, monthlyExpenses: [{ currency: 'INR', amount: 24_000 }] }),
    weather: raining,
  });
  const body = text(note);
  assert.ok(!/^[-*•#]/m.test(body), 'no bullets');
  assert.ok(!/\|/.test(body), 'no table pipes');
  assert.ok(!/\n/.test(body), 'one paragraph, not a stack');
  assert.match(body, /[.?]$/, 'it finishes as a sentence');
  // Two sentences, no more: short and on the point.
  const words = body.split(/\s+/).length;
  assert.ok(words <= 45, `caption was ${words} words: ${body}`);
  assert.ok(body.split(/(?<=[.?])\s/).length <= 2, `more than two sentences: ${body}`);
});

test('weather leads, and a forecast is never called the weather right now', () => {
  const now = settled({ weather: raining });
  assert.equal(now.id, 'weather-first');
  assert.match(now.caption, /right now/);

  const forecast = settled({ weather: weather({ rain: { soon: 15, peak: { probability: 80, hour: '9 pm' } } }) });
  assert.match(forecast.caption, /around 9 pm/, 'a forecast names its hour');
  assert.ok(!/right now/.test(forecast.caption));
});

test('spending is reported with its pace and its biggest category', () => {
  const note = settled({
    finance: finance({
      monthlyExpenses: [{ currency: 'INR', amount: 24_000 }],
      transactions: [{ id: '1', direction: 'expense', category: 'Food', amount: 9_000, occurredAt: '2026-09-20T00:00:00Z' }],
    } as Partial<FinanceSummary>),
  });
  assert.match(text(note), /₹24,000/);
  assert.match(text(note), /₹1,000 a day/);
  assert.match(text(note), /mostly on food/);
});

test('alerts waiting are asked for in plain words with an honest time cost', () => {
  assert.match(text(settled({ finance: finance({ pendingCandidateCount: 1 }) })), /one bank alert/i);
  assert.match(text(settled({ finance: finance({ pendingCandidateCount: 2 }) })), /2 bank alerts/);
  assert.match(text(settled({ finance: finance({ pendingCandidateCount: 12 }) })), /12 bank alerts/);
});

test('the portfolio line quotes a day only when it covers the portfolio', () => {
  assert.match(text(settled({ portfolio: portfolio({ day: { value: 4_820, percent: 1.01, coverage: 1 } }) })), /up ₹4,820|up 1\.0%/i);

  // A day drawn from part of the holdings says which part.
  assert.match(text(settled({ portfolio: portfolio({ day: { value: -2_100, percent: -0.6, coverage: 0.72 } }) })), /72% of it/);

  // Too thin to describe the portfolio: fall back to what is certain.
  const thin = settled({ portfolio: portfolio({ day: { value: 4_820, percent: 1.01, coverage: 0.25 } }) });
  assert.match(text(thin), /sits at ₹4,82,300/);
  assert.ok(!/today/.test(text(thin)));

  // Nothing linked is silence, never a zero.
  assert.ok(!/portfolio/i.test(text(settled({ portfolio: portfolio({ state: 'off', total: 0, holdingCount: 0, gain: null, largest: null }) }))));
});

test('setup suggestions only speak when there was nothing truer to say', () => {
  const busy = settled({
    finance: finance({ connection: null, pendingCandidateCount: 3, monthlyExpenses: [{ currency: 'INR', amount: 24_000 }] }),
    weather: raining,
    portfolio: portfolio({ day: { value: 4_820, percent: 1.01, coverage: 1 } }),
  });
  assert.ok(busy.caption.length > 0);
  assert.ok(!/Connect Gmail/.test(text(busy)), 'a nudge never displaces a reading');

  assert.match(text(settled({ finance: finance({ connection: null }) })), /Connect Gmail/);
});

test('Home never asks for a file upload', () => {
  assert.ok(!/workbook|upload|Excel|PDF/i.test(text(settled({ finance: finance({ connection: null }) }))), 'that errand belongs on the Health tab');
});

test('a quiet account gets one honest sentence, not a wall of nudges', () => {
  const note = settled();
  assert.equal(note.id, 'quiet');
  assert.match(note.caption, /Nothing needs you/);
});

test('the note lists the services behind it, once, with no duplicates', () => {
  const note = settled({
    weather: raining,
    finance: finance({ pendingCandidateCount: 2 }),
    portfolio: portfolio({ day: { value: 4_820, percent: 1.01, coverage: 1 } }),
  });
  // Two subjects ship, so two services are credited, not every one consulted.
  assert.deepEqual(note.sources, ['open-meteo', 'gmail']);
  assert.equal(new Set(note.sources).size, note.sources.length);
});

// ── House style ──────────────────────────────────────────────────────────────

test('the note never uses an em dash, whatever it is saying', () => {
  const everything = [
    settled({ weather: raining, training: training(), portfolio: portfolio({ day: { value: 4_820, percent: 1.01, coverage: 0.72 }, largest: { name: 'HDFCBANK', share: 0.52 } }), finance: finance({ pendingCandidateCount: 4, monthlyExpenses: [{ currency: 'INR', amount: 24_000 }] }) }),
    settled({ weather: weather({ temperature: 38 }), training: training({ today: { focus: 'Legs', rest: true, durationMinutes: null, exercises: [] } }) }),
    settled({ weather: weather({ temperature: 8 }) }),
    settled({ finance: finance({ connection: null }) }),
    settled({ finance: finance({ connection: { email: 'you@example.com', status: 'reconnect_required', lastSyncAt: null } }) }),
    settled(),
  ];
  for (const note of everything) {
    assert.ok(!/[—–]/.test(note.caption), `em dash in: ${note.caption}`);
    assert.ok(!/[—–]/.test(note.greeting));
  }
});

test('British spelling, not American', () => {
  const note = settled({ portfolio: portfolio({ day: { value: 4_820, percent: 1.01, coverage: 1 } }) });
  assert.ok(!/\b(realized|unrealized|favorite|color|analyze)\b/i.test(note.caption));
});

// ── The clock ────────────────────────────────────────────────────────────────

test('the note carries the time it was written for', () => {
  assert.match(settled().time, /^\d{1,2}:\d{2} (am|pm)$/);
  // 2pm UTC is 7:30pm in Kolkata, which is what the note must say.
  assert.equal(settled().time, '8:00 pm');
  assert.equal(composeNote({ finance: finance(), now: new Date('2026-09-24T03:30:00Z') }).when, 'morning');
  assert.equal(composeNote({ finance: finance(), now: new Date('2026-09-24T14:30:00Z') }).when, 'evening');
  assert.equal(composeNote({ finance: finance(), now: new Date('2026-09-24T17:00:00Z') }).when, 'night');
});

test('what it says about the gym depends on the hour', () => {
  const morning = composeNote({ finance: finance(), training: training(), now: new Date('2026-09-24T02:30:00Z') });
  assert.match(morning.caption, /Gym today|You’re down for/i);

  // By the evening the session is either done or it is not, so it asks.
  const evening = composeNote({ finance: finance(), training: training(), now: new Date('2026-09-24T14:30:00Z') });
  assert.match(evening.caption, /if you haven’t got to it/i);

  const night = composeNote({ finance: finance(), training: training(), now: new Date('2026-09-24T17:00:00Z') });
  assert.match(night.caption, /tomorrow’s the better fight/i);
});

test('a rest day is said plainly, and no plan means no gym sentence', () => {
  const rest = settled({ training: training({ today: { focus: 'Legs', rest: true, durationMinutes: null, exercises: [] } }) });
  assert.match(rest.caption, /rest day|resting/i);
  assert.ok(!/gym/i.test(text(settled({ training: training({ state: 'off', today: null }) }))));
});

test('the caption never lectures about the mix or the lifetime gain', () => {
  const note = settled({ portfolio: portfolio({ largest: { name: 'TATAGOLD', share: 0.86 }, gain: 66, day: { value: 12, percent: 0.5, coverage: 1 } }) });
  assert.ok(!/everything you hold|independent ones|concentrat/i.test(note.caption), 'no commentary on the mix');
  assert.ok(!/on what you paid/i.test(note.caption), 'no lifetime gain');
});

test('two subjects at most, whatever else is true', () => {
  const everything = settled({
    weather: raining,
    training: training(),
    finance: finance({ pendingCandidateCount: 4, monthlyExpenses: [{ currency: 'INR', amount: 24_000 }] }),
    portfolio: portfolio({ day: { value: 4_820, percent: 1.01, coverage: 1 } }),
  });
  assert.equal(everything.caption.split(/(?<=[.?])\s/).length, 2);
  // Credits list what the caption kept, not every reading that was considered.
  assert.deepEqual(everything.sources, ['open-meteo', 'orbis']);
});

test('the weather is one sentence, with no follow-on forecast', () => {
  const note = settled({ weather: raining });
  assert.equal(note.caption.split(/(?<=[.?])\s/)[0], 'Rain showers out there right now, 26°.');
  assert.ok(!/gap to wait out|still 90%/.test(note.caption));
});

// ── The schedule ─────────────────────────────────────────────────────────────

const due = (over: Partial<import('../routines/types.ts').RoutineToday> = {}) => ({
  routine: { id: 'gym', title: 'Gym', kind: 'workout' as const, atTime: '19:00', days: [0, 1, 2, 3, 4, 5, 6], active: true },
  minutesAway: 0,
  event: null,
  ...over,
});

test('what is due leads the caption, ahead of weather and money', () => {
  const note = settled({
    routine: due(),
    weather: raining,
    finance: finance({ pendingCandidateCount: 3, monthlyExpenses: [{ currency: 'INR', amount: 24_000 }] }),
  });
  assert.equal(note.id, 'routine-first');
  assert.match(note.caption.split(/(?<=[.?])\s/)[0], /^Gym is now, at 7 pm\./);
});

test('the wording follows the clock, not just the schedule', () => {
  assert.match(settled({ routine: due({ minutesAway: 120 }) }).caption, /^Gym is next, at 7 pm\./);
  assert.match(settled({ routine: due({ minutesAway: 25 }) }).caption, /^Gym is in 25 minutes, at 7 pm\./);
  assert.match(settled({ routine: due({ minutesAway: -70 }) }).caption, /^Gym was 1 hour ago, at 7 pm\./);
});

test('routines that went by unanswered are mentioned, then stop being counted individually', () => {
  const one = settled({ routine: due(), missed: [due({ routine: { ...due().routine, id: 'lunch', title: 'Lunch', kind: 'meal' } })] });
  assert.match(one.caption, /Lunch went by unanswered/);

  const many = settled({ routine: due(), missed: [due(), due(), due()] });
  assert.match(many.caption, /3 earlier ones went by unanswered/);
});

test('a scheduled workout silences the plan’s own gym sentence', () => {
  const note = settled({ routine: due(), training: training() });
  assert.ok(!/today’s card|Gym today is/.test(note.caption), 'the brief must not say the same thing twice');

  // A meal routine does not cover the gym, so the plan still speaks.
  const meal = settled({ routine: due({ routine: { ...due().routine, kind: 'meal', title: 'Dinner' } }), training: training() });
  assert.match(meal.caption, /Dinner is now/);
  assert.match(meal.caption, /still on today’s card|Gym today/);
});
