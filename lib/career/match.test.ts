import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { CareerProfile, CareerSpec, NormalizedJob, Requirements } from './types.ts';
import { annualise, formatMoney, placeCovers, roleFit, scoreMatch, withSkill } from './match.ts';
import { emptySpec } from './spec.ts';

const TODAY = '2026-10-27';

// An Indian frontend developer: Infosys 2019-07..2022-03 (2.8 y), Razorpay 2022-04..now (4.6 y); 7.3 years in all.
const profile: CareerProfile = {
  contact: { name: 'Aarav Sharma', email: 'aarav.sharma@gmail.com', phone: null, location: 'Bengaluru, India', links: [] },
  headline: 'Frontend Engineer',
  summary: null,
  roles: [
    { id: 'r_razorpay', title: 'Frontend Engineer', employer: 'Razorpay', location: 'Bengaluru', start: '2022-04', end: null },
    { id: 'r_infosys1', title: 'Systems Engineer', employer: 'Infosys', location: 'Pune', start: '2019-07', end: '2022-03' },
  ],
  education: [],
  certifications: [],
  projects: [],
  skills: [
    { name: 'react', label: 'React', years: null }, { name: 'typescript', label: 'TypeScript', years: null },
    { name: 'next.js', label: 'Next.js', years: null }, { name: 'jest', label: 'Jest', years: null },
    { name: 'angular', label: 'Angular', years: null }, { name: 'vite', label: 'Vite', years: null },
    // Listed, with years even, but no fact or role backs it: it must not count.
    { name: 'graphql', label: 'GraphQL', years: 3 },
  ],
  facts: [
    { id: 'f_checkout', text: 'Rebuilt the checkout page in React and TypeScript', roleId: 'r_razorpay', skills: ['react', 'typescript'], confirmed: true },
    { id: 'f_nextmig1', text: 'Migrated the merchant dashboard to Next.js', roleId: 'r_razorpay', skills: ['next.js'], confirmed: false },
    { id: 'f_jesttest', text: 'Raised unit test coverage to 80% with Jest', roleId: 'r_razorpay', skills: ['jest'], confirmed: false },
    { id: 'f_angular1', text: 'Maintained an Angular dashboard for a banking client', roleId: 'r_infosys1', skills: ['angular', 'javascript'], confirmed: false },
    { id: 'f_vitepl01', text: 'Published an open-source Vite plugin', roleId: null, skills: ['vite'], confirmed: false },
  ],
  languages: ['English', 'Hindi'],
};

const spec: CareerSpec = {
  ...emptySpec(),
  roles: ['Frontend Engineer', 'React Developer'],
  seniority: ['senior'],
  workModes: ['remote'],
  locations: ['India', 'Bengaluru'],
  salaryFloor: { amount: 3_000_000, currency: 'INR', period: 'year' },
  dealBreakers: ['crypto'],
};

const job = (over: Partial<NormalizedJob> = {}): NormalizedJob => ({
  source: 'remotive', sourceRef: 'rm-1', title: 'Senior Frontend Engineer', company: 'Plane', location: null, remote: true,
  url: 'https://remotive.com/remote-jobs/software-dev/senior-frontend-engineer-1', applyUrl: null, applyEmail: null,
  description: 'A long and detailed description.', thin: false, salary: null, postedAt: '2026-10-25', attribution: 'via Remotive', ...over,
});

const requirements = (over: Partial<Requirements> = {}): Requirements => ({
  version: 1,
  mustHave: [{ skill: 'react', years: 3 }, { skill: 'typescript', years: null }, { skill: 'graphql', years: null }],
  niceToHave: [{ skill: 'next.js', years: null }, { skill: 'tailwind css', years: null }],
  minYears: 5,
  seniority: 'senior',
  education: null,
  locationPolicy: { mode: 'remote', where: ['APAC'] },
  timezones: [],
  salary: null,
  employmentType: 'full_time',
  visa: null,
  applyEmail: null,
  screeningQuestions: [],
  ...over,
});

const score = (over: { job?: Partial<NormalizedJob>; req?: Partial<Requirements> | null; spec?: Partial<CareerSpec>; profile?: CareerProfile; synonyms?: string[][] } = {}) =>
  scoreMatch({
    profile: over.profile ?? profile,
    spec: { ...spec, ...over.spec },
    job: job(over.job),
    requirements: over.req === null ? null : requirements(over.req),
    today: TODAY,
    synonyms: over.synonyms,
  });

test('the design formula on a realistic remote job', () => {
  const match = score();
  // must: react met, typescript met, graphql missing → 2/3 × 60 = 40
  // nice: next.js met, tailwind missing → 1/2 × 20 = 10; experience 10; role 10.
  assert.equal(match.score, 70);
  assert.deepEqual(match.parts, { must: 40, nice: 10, experience: 10, role: 10 });
  assert.equal(match.confidence, 'high');
  assert.equal(match.excluded, null);
  assert.deepEqual(match.lines.map((line) => [line.requirement.skill, line.kind, line.verdict]), [
    ['react', 'must', 'met'], ['typescript', 'must', 'met'], ['graphql', 'must', 'missing'],
    ['next.js', 'nice', 'met'], ['tailwind css', 'nice', 'missing'],
  ]);
});

test('each line carries its evidence and a short note', () => {
  const [react, , graphql] = score().lines;
  assert.deepEqual(react.evidence, ['f_checkout', 'r_razorpay']);
  assert.equal(react.note, '4.6 years, at Razorpay');
  assert.deepEqual(graphql.evidence, []);
  assert.equal(graphql.note, 'Not in your profile');
});

test('a listed skill without a fact or role behind it does not count', () => {
  const line = score().lines.find((item) => item.requirement.skill === 'graphql');
  assert.equal(line?.verdict, 'missing');
});

test('fewer years than asked is partial', () => {
  const match = score({ req: { mustHave: [{ skill: 'React.js', years: 6 }], niceToHave: [] } });
  assert.equal(match.lines[0].verdict, 'partial');
  assert.equal(match.lines[0].note, '4.6 years of 6 asked, at Razorpay');
  // No nice-to-haves: their 20 joins the must-haves, 80 × 0.5 = 40.
  assert.equal(match.parts.must, 40);
  assert.equal(match.score, 60);
});

test('years asked but only a role-less fact backs the skill: partial', () => {
  const match = score({ req: { mustHave: [{ skill: 'vite', years: 2 }], niceToHave: [] } });
  assert.equal(match.lines[0].verdict, 'partial');
  assert.equal(match.lines[0].note, 'Shown in 1 fact, but no dated role backs 2 years');
  assert.deepEqual(match.lines[0].evidence, ['f_vitepl01']);
});

test('a closely related skill is partial', () => {
  const match = score({ req: { mustHave: [{ skill: 'preact', years: null }], niceToHave: [] } });
  assert.equal(match.lines[0].verdict, 'partial');
  assert.equal(match.lines[0].note, 'Related: react, at Razorpay');
});

test('years at two employers are named both', () => {
  const p = { ...profile, facts: [...profile.facts, { id: 'f_reactinf', text: 'Built React widgets', roleId: 'r_infosys1', skills: ['react'], confirmed: false }] };
  const match = score({ profile: p, req: { mustHave: [{ skill: 'react', years: 7 }], niceToHave: [] } });
  assert.equal(match.lines[0].verdict, 'met');
  assert.equal(match.lines[0].note, '7.3 years, at Razorpay and Infosys');
});

test('all must-haves missing', () => {
  const match = score({ req: { mustHave: [{ skill: 'kotlin', years: null }, { skill: 'swift', years: null }], niceToHave: [] } });
  assert.deepEqual(match.parts, { must: 0, nice: 0, experience: 10, role: 10 });
  assert.equal(match.score, 20);
});

test('no must-haves: their 60 moves to the nice-to-haves', () => {
  const match = score({ req: { mustHave: [], niceToHave: [{ skill: 'react', years: null }, { skill: 'vue', years: null }] } });
  assert.deepEqual(match.parts, { must: 0, nice: 40, experience: 10, role: 10 });
  assert.equal(match.score, 60);
});

test('no skills listed at all: the points move to role fit', () => {
  const match = score({ req: { mustHave: [], niceToHave: [] } });
  assert.deepEqual(match.parts, { must: 0, nice: 0, experience: 10, role: 90 });
  assert.equal(match.score, 100);
});

test('experience fit: short of minYears and a step off in seniority', () => {
  const match = score({ req: { minYears: 10, seniority: 'lead' } });
  // years 7.3 / 10 = 0.73, seniority one step from senior = 0.5 → mean 0.615 → 6.2 of 10.
  assert.equal(match.parts.experience, 6.2);
  assert.ok(Number.isInteger(match.score));
});

test('no requirements: low confidence, scored on role fit alone and capped', () => {
  const match = score({ req: null });
  assert.equal(match.confidence, 'low');
  assert.equal(match.score, 70);
  assert.deepEqual(match.parts, { must: 0, nice: 0, experience: 0, role: 70 });
  assert.deepEqual(match.lines, []);
});

test('thin jobs are low confidence; a held but untargeted role counts half', () => {
  const thin = { thin: true, description: null };
  assert.equal(score({ job: { ...thin, title: 'Backend Engineer' }, req: null }).score, 0);
  assert.equal(score({ job: { ...thin, title: 'Systems Engineer' }, req: null }).score, 35);
  const withReqs = score({ job: thin });
  assert.equal(withReqs.confidence, 'low');
  assert.equal(withReqs.score, 70);
  assert.equal(withReqs.lines.length, 5, 'lines are still shown');
});

test('owner synonyms count for role fit', () => {
  assert.equal(score({ job: { title: 'Web Developer' }, req: null }).score, 0);
  assert.equal(score({ job: { title: 'Web Developer' }, req: null, synonyms: [['frontend', 'web developer']] }).score, 70);
  assert.equal(roleFit('UI Engineer', spec, profile), 1);
});

test('excluded by salary: a known max below the floor, after converting the period', () => {
  const yearly = score({ req: { salary: { min: 1_200_000, max: 1_800_000, currency: 'INR', period: 'year' } } });
  assert.equal(yearly.excluded, 'Pays up to ₹18L a year; your floor is ₹30L');
  assert.equal(yearly.score, 70, 'the score is still computed');
  const monthly = (max: number) => score({ req: { salary: { min: null, max, currency: 'INR', period: 'month' } } }).excluded;
  assert.equal(monthly(150_000), 'Pays up to ₹18L a year; your floor is ₹30L');
  assert.equal(monthly(300_000), null);
  const hourly = score({ req: { salary: { min: null, max: 1000, currency: 'INR', period: 'hour' } } });
  assert.equal(hourly.excluded, 'Pays up to ₹20.8L a year; your floor is ₹30L');
});

test('salary filter is skipped across currencies, without a max, and falls back to the listing', () => {
  assert.equal(score({ req: { salary: { min: null, max: 60, currency: 'USD', period: 'hour' } } }).excluded, null);
  assert.equal(score({ req: { salary: { min: 1_000_000, max: null, currency: 'INR', period: 'year' } } }).excluded, null);
  const listing = score({ job: { salary: { min: null, max: 2_000_000, currency: 'inr', period: 'year' } } });
  assert.equal(listing.excluded, 'Pays up to ₹20L a year; your floor is ₹30L');
});

test('excluded by a deal-breaker in the title or the must-haves', () => {
  assert.equal(score({ job: { title: 'Frontend Engineer, Crypto Exchange' } }).excluded, 'Deal-breaker: crypto');
  const php = score({ spec: { dealBreakers: ['PHP'] }, req: { mustHave: [{ skill: 'php', years: null }] } });
  assert.equal(php.excluded, 'Deal-breaker: requires PHP');
});

test('excluded by work mode', () => {
  const onsite = score({ job: { remote: false, location: 'Berlin, Germany' }, req: { locationPolicy: { mode: 'onsite', where: [] } } });
  assert.equal(onsite.excluded, 'Onsite role; you want remote');
});

test('excluded by place: an office elsewhere, or a remote job closed to India', () => {
  const hybridSpec = { workModes: ['remote', 'hybrid'] as CareerSpec['workModes'] };
  const hybrid = (location: string) => score({ spec: hybridSpec, job: { remote: false, location }, req: { locationPolicy: { mode: 'hybrid', where: [] } } }).excluded;
  assert.equal(hybrid('Bangalore, Karnataka'), null);
  assert.equal(hybrid('Mumbai'), null, 'India is acceptable');
  assert.equal(hybrid('London, UK'), 'In London, UK; you want India, Bengaluru');
  const remote = (where: string[]) => score({ req: { locationPolicy: { mode: 'remote', where } } }).excluded;
  assert.equal(remote(['US']), 'Remote, US only; you want India, Bengaluru');
  assert.equal(remote(['Worldwide']), null);
  assert.equal(remote(['EMEA', 'APAC']), null);
  assert.equal(remote([]), null);
});

test('placeCovers', () => {
  assert.equal(placeCovers('Bengaluru, Karnataka, India', 'India'), true);
  assert.equal(placeCovers('India', 'Pune'), true);
  assert.equal(placeCovers('APAC', 'India'), true);
  assert.equal(placeCovers('United States', 'USA'), true);
  assert.equal(placeCovers('Remote (India)', 'Bengaluru'), true);
  assert.equal(placeCovers('Bengaluru', 'Pune'), false);
  assert.equal(placeCovers('EMEA', 'India'), false);
});

test('withSkill adds an evidenced skill for counterfactual scoring, without touching the profile', () => {
  const before = JSON.stringify(profile);
  const boosted = withSkill(profile, 'GraphQL');
  assert.equal(JSON.stringify(profile), before);
  const match = scoreMatch({ profile: boosted, spec, job: job(), requirements: requirements(), today: TODAY });
  assert.equal(match.score, 90);
  const k8s = requirements({ mustHave: [{ skill: 'kubernetes', years: 3 }], niceToHave: [] });
  const verdict = (p: CareerProfile) => scoreMatch({ profile: p, spec, job: job(), requirements: k8s, today: TODAY }).lines[0].verdict;
  assert.equal(verdict(profile), 'missing');
  assert.equal(verdict(withSkill(profile, 'k8s')), 'partial');
  assert.equal(verdict(withSkill(profile, 'k8s', 4)), 'met');
});

test('money helpers', () => {
  assert.equal(annualise(1000, 'hour'), 2_080_000);
  assert.equal(annualise(80_000, 'month'), 960_000);
  assert.equal(formatMoney(12_000_000, 'INR'), '₹1.2Cr');
  assert.equal(formatMoney(120_000, 'USD'), 'USD 120k');
});
