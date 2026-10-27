import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildPrepPrompt, inZone, parsePrepReply, prepLogistics } from './prep.ts';
import type { CareerFact, Match, Requirements } from './types.ts';

const fact = (id: string, text: string): CareerFact => ({ id, text, roleId: null, skills: [], confirmed: true });
const profile = { facts: [fact('f_aaaaaaaa', 'Cut p95 latency from 900 ms to 250 ms at Acme'), fact('f_bbbbbbbb', 'Led a team of 4')], headline: 'Frontend engineer', summary: null };

const requirements: Requirements = {
  version: 1, mustHave: [{ skill: 'react', years: 3 }, { skill: 'graphql', years: null }], niceToHave: [], minYears: null, seniority: 'senior',
  education: null, locationPolicy: { mode: null, where: [] }, timezones: [], salary: null, employmentType: null, visa: null, applyEmail: null, screeningQuestions: [],
};

const match: Match = {
  score: 70, confidence: 'high', parts: { must: 0, nice: 0, experience: 0, role: 0 }, excluded: null,
  lines: [
    { requirement: { skill: 'react', years: 3 }, kind: 'must', verdict: 'met', evidence: ['f_aaaaaaaa'], note: '5 years' },
    { requirement: { skill: 'graphql', years: null }, kind: 'must', verdict: 'missing', evidence: [], note: '' },
  ],
};

test('the prompt lists facts by id, requirements and gaps', () => {
  const prompt = buildPrepPrompt({
    job: { title: 'Senior frontend engineer', company: 'Acme', description: 'Build things.' }, requirements, match, profile,
    classification: { interviewFormat: 'video', summary: 'Acme invites you to a call.', role: null },
  });
  assert.match(prompt.user, /f_aaaaaaaa: Cut p95 latency/);
  assert.match(prompt.user, /Must have: react \(3\+ years\), graphql/);
  assert.match(prompt.user, /- graphql \(must, missing\)/);
  assert.doesNotMatch(prompt.user, /- react/);
  assert.match(prompt.user, /Invite: Acme invites you to a call\. \(video\)/);
  assert.match(prompt.system, /never invent experience/);
});

test('stories citing unknown facts are dropped', () => {
  const prep = parsePrepReply(JSON.stringify({
    likelyTopics: [
      { topic: 'Performance', why: 'They ship a heavy app.', stories: [{ factId: 'f_aaaaaaaa', prompt: 'S: slow pages…' }, { factId: 'f_made_up', prompt: 'Invented' }] },
      { topic: '', why: 'no topic' },
    ],
    questionsToAsk: ['How is success measured in 90 days?'],
    gaps: [{ skill: 'graphql', framing: 'Used REST deeply; learning GraphQL.' }, { skill: 'x' }],
  }), profile);
  assert.deepEqual(prep, {
    logistics: { at: null, format: null, link: null },
    likelyTopics: [{ topic: 'Performance', why: 'They ship a heavy app.', stories: [{ factId: 'f_aaaaaaaa', prompt: 'S: slow pages…' }] }],
    questionsToAsk: ['How is success measured in 90 days?'],
    gaps: [{ skill: 'graphql', framing: 'Used REST deeply; learning GraphQL.' }],
  });
});

test('an empty or broken reply is no prep', () => {
  assert.equal(parsePrepReply('{}', profile), null);
  assert.equal(parsePrepReply('nope', profile), null);
});

test('logistics show the time in the owner\'s zone', () => {
  assert.equal(inZone('2026-11-03T10:00:00Z', 'Asia/Kolkata'), '2026-11-03T15:30:00+05:30');
  assert.equal(inZone('2026-11-03T10:00:00Z', 'UTC'), '2026-11-03T10:00:00+00:00');
  assert.equal(inZone('2026-11-03T10:00:00Z', 'Not/AZone'), null);
  assert.deepEqual(prepLogistics({ interviewAt: '2026-11-03T15:30:00+05:30', interviewFormat: 'video', meetingLink: 'https://meet.example/x' }, 'Europe/London'), {
    at: '2026-11-03T10:00:00+00:00', format: 'video', link: 'https://meet.example/x',
  });
  assert.deepEqual(prepLogistics({ interviewAt: 'next Tuesday', interviewFormat: null, meetingLink: 'http://insecure' }, 'UTC'), { at: null, format: null, link: null });
  // A bad zone keeps the invite's own time rather than dropping it.
  assert.equal(prepLogistics({ interviewAt: '2026-11-03T15:30:00+05:30', interviewFormat: null, meetingLink: null }, 'Bad/Zone').at, '2026-11-03T15:30:00+05:30');
});
