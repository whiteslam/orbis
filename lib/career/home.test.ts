import { test } from 'vitest';
import assert from 'node:assert/strict';
import { cardJob, CARD_DESCRIPTION_CHARS, composeHome, localDay, weekNumbers, weekStart, type HomeInput } from './home.ts';
import { DEFAULT_SETTINGS, type ApplicationStatus, type CareerApplication, type CareerEvent, type CareerJob, type CareerState } from './types.ts';

const TZ = 'Asia/Kolkata';
const NOW = new Date('2026-10-28T06:30:00Z'); // Wednesday 28 Oct, noon in India

function job(id: string, overrides: Partial<CareerJob> = {}): CareerJob {
  return {
    id, source: 'greenhouse', sourceRef: id, dedupeKey: id, title: `Role ${id}`, company: `Company ${id}`, location: null, remote: true,
    url: `https://example.com/${id}`, applyUrl: null, applyEmail: null, description: 'A description.', thin: false, salary: null,
    postedAt: null, attribution: null, seenOn: [], requirements: null, match: null, score: 60, state: 'new', dismissReason: null,
    foundAt: '2026-10-20T00:00:00Z', ...overrides,
  };
}

function app(id: string, status: ApplicationStatus, overrides: Partial<CareerApplication> = {}): CareerApplication {
  return {
    id, jobId: `j${id}`, status, route: 'email', draft: null, coverNote: null, answers: [], outreach: null, removed: [], ats: null,
    hasPdf: true, hasDocx: true, sentAt: null, gmailThreadId: null, companyDomains: [], followUpDue: null, followUpDraft: null,
    prediction: null, prep: null, lastEventAt: null, notes: null, updatedAt: '2026-10-20T00:00:00Z', ...overrides,
  };
}

function event(id: string, kind: CareerEvent['kind'], at: string, applicationId: string | null, details: Record<string, unknown> = {}): CareerEvent {
  return { id, applicationId, kind, at, summary: `${kind} ${id}`, details, gmailMessageId: null };
}

const state: CareerState = {
  ready: true, profile: null, spec: null, settings: { ...DEFAULT_SETTINGS, weeklyGoal: 10 }, resumeFileName: null,
  gmail: { connected: true, canSend: false }, lastIngestAt: null,
};

function input(overrides: Partial<HomeInput>): HomeInput {
  return { state, applications: [], jobs: [], events: [], unmatched: [], hotMatches: [], forYouCount: 0, now: NOW, timeZone: TZ, ...overrides };
}

test('days and weeks are the owner’s, not UTC’s', () => {
  assert.equal(localDay('2026-10-26T20:00:00Z', TZ), '2026-10-27');
  assert.equal(weekStart('2026-10-28'), '2026-10-26');
  assert.equal(weekStart('2026-10-26'), '2026-10-26');
  assert.equal(weekStart('2026-11-01'), '2026-10-26');
});

test('long descriptions are cut for lists', () => {
  const long = cardJob(job('a', { description: 'x'.repeat(5000) }));
  assert.equal(long.description?.length, CARD_DESCRIPTION_CHARS);
  const short = job('b');
  assert.equal(cardJob(short), short);
});

test('the queue is ready applications, best match first; the pipeline is everything past drafting', () => {
  const home = composeHome(input({
    applications: [app('1', 'ready'), app('2', 'ready'), app('3', 'drafting'), app('4', 'sent', { lastEventAt: '2026-10-27T00:00:00Z' })],
    jobs: [job('j1', { score: 55 }), job('j2', { score: 90 }), job('j3'), job('j4')],
    forYouCount: 4,
  }));
  assert.deepEqual(home.queue.map((card) => card.application.id), ['2', '1']);
  assert.deepEqual(home.pipeline.map((card) => card.application.id), ['4', '1', '2']);
  assert.equal(home.counts.queue, 2);
  assert.equal(home.counts.forYou, 4);
  assert.equal(home.insights, null);
});

test('an application whose job is gone is left out rather than shown half-empty', () => {
  const home = composeHome(input({ applications: [app('1', 'ready')], jobs: [] }));
  assert.equal(home.queue.length, 0);
  assert.equal(home.counts.queue, 0, 'the badge matches what the queue shows');
});

test('upcoming interviews: the prep pack’s time, else the invite’s; past ones drop off; undated last', () => {
  const prepped = app('1', 'interview', { prep: { logistics: { at: '2026-10-30T05:00:00Z', format: 'video', link: 'https://meet' }, likelyTopics: [], questionsToAsk: [], gaps: [] } });
  const fromInvite = app('2', 'interview');
  const past = app('3', 'interview', { prep: { logistics: { at: '2026-10-20T05:00:00Z', format: null, link: null }, likelyTopics: [], questionsToAsk: [], gaps: [] } });
  const undated = app('4', 'interview');
  const home = composeHome(input({
    applications: [undated, past, fromInvite, prepped],
    jobs: [job('j1'), job('j2'), job('j3'), job('j4')],
    events: [event('e1', 'interview_invite', '2026-10-27T00:00:00Z', '2', { interviewAt: '2026-10-29T04:00:00Z', interviewFormat: 'phone' })],
  }));
  assert.deepEqual(home.upcoming.map((item) => [item.application.id, item.at, item.format]), [
    ['2', '2026-10-29T04:00:00Z', 'phone'],
    ['1', '2026-10-30T05:00:00Z', 'video'],
    ['4', null, null],
  ]);
  assert.equal(home.counts.interviews, 4);
});

test('follow-ups: a drafted one waiting for Send, or one whose day has come, while nobody replied', () => {
  const home = composeHome(input({
    applications: [
      app('1', 'sent', { followUpDraft: 'Hi again', followUpDue: null }),
      app('2', 'acknowledged', { followUpDue: '2026-10-27T00:00:00Z' }),
      app('3', 'sent', { followUpDue: '2026-11-02T00:00:00Z' }),
      app('4', 'replied', { followUpDraft: 'Hi again' }),
    ],
    jobs: [job('j1'), job('j2'), job('j3'), job('j4')],
  }));
  assert.deepEqual(home.followUps.map((card) => card.application.id).sort(), ['1', '2']);
});

test('recent activity carries the company and title; unmatched replies are counted', () => {
  const unmatched = [event('u1', 'reply', '2026-10-27T00:00:00Z', null)];
  const home = composeHome(input({
    applications: [app('1', 'sent')],
    jobs: [job('j1', { company: 'Acme', title: 'Dev' })],
    events: [event('e1', 'sent', '2026-10-27T00:00:00Z', '1'), unmatched[0]],
    unmatched,
  }));
  assert.deepEqual(home.recent.map((item) => [item.id, item.company, item.title]), [['e1', 'Acme', 'Dev'], ['u1', null, null]]);
  assert.equal(home.counts.unmatched, 1);
});

test('the week: sent this week and last, interviews booked, and no reply rate under five sent', () => {
  const sent = (id: string, sentAt: string, status: ApplicationStatus = 'sent') => app(id, status, { sentAt });
  const applications = [
    sent('1', '2026-10-26T03:00:00Z', 'replied'), // Monday this week
    sent('2', '2026-10-25T19:00:00Z'), // Monday 00:30 in India: this week
    sent('3', '2026-10-21T10:00:00Z', 'rejected'), // last week
    sent('4', '2026-10-01T10:00:00Z', 'ghosted'),
  ];
  const events = [event('e1', 'interview_invite', '2026-10-27T10:00:00Z', '1'), event('e2', 'interview_invite', '2026-10-27T10:00:00Z', null)];
  const week = weekNumbers({ applications, events, goal: 10, today: '2026-10-28', timeZone: TZ });
  assert.deepEqual(week, { sent: 2, goal: 10, sentLastWeek: 1, interviews: 1, replyRate: null });
  const more = weekNumbers({ applications: [...applications, sent('5', '2026-09-01T00:00:00Z')], events: [], goal: 10, today: '2026-10-28', timeZone: TZ });
  assert.equal(more.replyRate, 0.4);
});

test('hot matches stop at six', () => {
  const hotMatches = Array.from({ length: 9 }, (_, index) => job(`h${index}`));
  assert.equal(composeHome(input({ hotMatches })).hotMatches.length, 6);
});
