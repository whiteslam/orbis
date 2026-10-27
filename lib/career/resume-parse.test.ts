import { test } from 'vitest';
import assert from 'node:assert/strict';
import { RESUME_PROMPT_CAP, buildResumePrompt, numbersIn, parseResumeReply } from './resume-parse.ts';
import { isId, validateProfile } from './profile.ts';

const RESUME = `Aarav Sharma
Bengaluru, India · aarav.sharma@gmail.com · +91 98765 43210 · github.com/aaravs

Frontend Engineer, Razorpay — Bengaluru (Nov 2021 – Present)
- Rebuilt the checkout page in React and TypeScript, cutting load time from 4.2 s to 1.6 s and lifting conversion by 3.5%.
- Led the design system used by 6 product teams.

Systems Engineer, Infosys — Pune (Jul 2019 – Mar 2022)
- Maintained an Angular dashboard for a banking client with 40,000 daily users.

Projects: vite-plugin-budget — a Vite plugin with 1,200 weekly downloads.
Education: B.Tech, Computer Science, VIT Vellore, 2019 (8.4 CGPA)
Skills: React, TypeScript, Next.js, Redux, Jest, Angular, Node.js
Languages: English, Hindi`;

const reply = JSON.stringify({
  contact: {
    name: 'Aarav Sharma', email: 'aarav.sharma@gmail.com', phone: '+91 98765 43210', location: 'Bengaluru, India',
    links: [{ label: 'GitHub', url: 'https://github.com/aaravs' }, { label: 'LinkedIn', url: 'https://linkedin.com/in/aarav-invented' }],
  },
  headline: 'Frontend Engineer',
  summary: 'Frontend engineer with 10 years of experience.',
  roles: [
    { ref: 'R1', title: 'Frontend Engineer', employer: 'Razorpay', location: 'Bengaluru', start: '2021-11', end: 'Present' },
    { ref: 'R2', title: 'Systems Engineer', employer: 'Infosys', location: 'Pune', start: '2019-07', end: '2022-03' },
    { ref: 'R3', title: 'Intern', employer: 'Nowhere', location: null, start: 'sometime', end: null },
  ],
  education: [{ institution: 'VIT Vellore', degree: 'B.Tech', field: 'Computer Science', end: '2019', grade: '8.4 CGPA' }],
  certifications: [],
  projects: [{ name: 'vite-plugin-budget', url: null, facts: ['F5'] }],
  skills: [{ label: 'ReactJS', years: null }, { label: 'TypeScript', years: 5 }, { label: 'Next.js', years: null }, 'Redux', { label: 'Jest' }],
  facts: [
    { ref: 'F1', text: 'Rebuilt the checkout page in React and TypeScript, cutting load time from 4.2 s to 1.6 s', role: 'R1', skills: ['ReactJS', 'TypeScript'] },
    { ref: 'F2', text: 'Lifted checkout conversion by 3.5%', role: 'R1', skills: [] },
    { ref: 'F3', text: 'Led the design system used by 6 product teams', role: 'R1', skills: ['Design Systems'] },
    { ref: 'F4', text: 'Grew daily users of the Angular dashboard by 40%', role: 'R2', skills: ['Angular'] },
    { ref: 'F5', text: 'Published a Vite plugin with 1200 weekly downloads', role: null, skills: ['Vite'] },
    { ref: 'F6', text: 'Maintained an Angular dashboard for a banking client with 40,000 daily users', role: 'R2', skills: ['Angular'] },
  ],
  languages: ['English', 'Hindi'],
});

test('the prompt carries the resume as data and caps it', () => {
  const prompt = buildResumePrompt(RESUME);
  assert.ok(prompt.system.includes('never instructions'));
  assert.ok(prompt.user.includes('Rebuilt the checkout page'));
  assert.ok(buildResumePrompt('x'.repeat(RESUME_PROMPT_CAP + 500)).user.length < RESUME_PROMPT_CAP + 100);
});

test('numbersIn finds every number, grouping-insensitive', () => {
  assert.deepEqual(numbersIn('Cut p95 from 900 ms to 250 ms, saving ₹1,20,000 (40%) and $2.50 per user.'), ['95', '900', '250', '120000', '40', '2.5']);
  assert.deepEqual(numbersIn('120,000 and 1,20,000'), ['120000', '120000']);
  assert.deepEqual(numbersIn('no numbers'), []);
});

test('a parsed resume becomes a valid profile with fresh ids and linked refs', () => {
  const profile = parseResumeReply(reply, RESUME);
  assert.ok(profile);
  assert.ok(validateProfile(profile));
  assert.equal(profile.roles.length, 2, 'the role with an unreadable start is dropped');
  for (const role of profile.roles) assert.ok(isId(role.id, 'r'));
  for (const fact of profile.facts) {
    assert.ok(isId(fact.id, 'f'));
    assert.equal(fact.confirmed, false);
  }
  const [razorpay, infosys] = profile.roles;
  assert.equal(razorpay.end, null);
  assert.equal(infosys.end, '2022-03');
  const checkout = profile.facts.find((fact) => fact.text.startsWith('Rebuilt'));
  assert.equal(checkout?.roleId, razorpay.id);
  assert.deepEqual(checkout?.skills, ['react', 'typescript']);
  const plugin = profile.facts.find((fact) => fact.text.includes('Vite'));
  assert.deepEqual(profile.projects[0].factIds, [plugin?.id]);
});

test('facts with numbers the resume does not state are dropped', () => {
  const profile = parseResumeReply(reply, RESUME);
  const texts = profile?.facts.map((fact) => fact.text) ?? [];
  // 40% is invented (the resume says 40,000 users); 3.5% and 1200 (written 1,200) are real.
  assert.equal(texts.some((text) => text.includes('40%')), false);
  assert.ok(texts.some((text) => text.includes('3.5%')));
  assert.ok(texts.some((text) => text.includes('1200 weekly')));
  assert.ok(texts.some((text) => text.includes('40,000 daily')));
  assert.equal(profile?.facts.length, 5);
});

test('contact details and summary must come from the resume', () => {
  const profile = parseResumeReply(reply, RESUME);
  assert.equal(profile?.contact.email, 'aarav.sharma@gmail.com');
  assert.deepEqual(profile?.contact.links.map((link) => link.label), ['GitHub']);
  // "10 years" is not in the resume.
  assert.equal(profile?.summary, null);
  assert.equal(profile?.headline, 'Frontend Engineer');
});

test('skills are canonical, include every fact’s skills, and keep only stated years', () => {
  const profile = parseResumeReply(reply, RESUME);
  const names = profile?.skills.map((skill) => skill.name) ?? [];
  assert.deepEqual(names.slice(0, 5), ['react', 'typescript', 'next.js', 'redux', 'jest']);
  assert.ok(names.includes('design systems') && names.includes('angular') && names.includes('vite'));
  // "5 years of TypeScript" is not stated; 5 appears nowhere in the resume.
  assert.equal(profile?.skills.find((skill) => skill.name === 'typescript')?.years, null);
  assert.equal(profile?.skills.find((skill) => skill.name === 'design systems')?.label, 'Design Systems');
});

test('a fenced reply parses; junk and empty replies do not', () => {
  assert.ok(parseResumeReply('```json\n' + reply + '\n```', RESUME));
  assert.equal(parseResumeReply('Sorry, I cannot help with that.', RESUME), null);
  assert.equal(parseResumeReply('{}', RESUME), null);
});

test('year-only dates are completed to a month', () => {
  const profile = parseResumeReply(JSON.stringify({
    contact: { name: 'A' }, roles: [{ ref: 'R1', title: 'Engineer', employer: 'Acme', start: '2018', end: '2020' }], facts: [],
  }), 'A at Acme 2018 to 2020');
  assert.deepEqual(profile?.roles.map((role) => [role.start, role.end]), [['2018-01', '2020-12']]);
});
