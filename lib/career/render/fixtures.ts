/**
 * A realistic profile, spec, requirements and tailored draft, shared by the
 * career tests (render, tailor, truth, ats). Test data only.
 */
import type { CareerProfile, CareerSpec, Requirements, TailoredDraft } from '../types.ts';

export const sampleProfile = (): CareerProfile => ({
  contact: {
    name: 'Priya Raman',
    email: 'priya.raman@example.com',
    phone: '+91 98765 43210',
    location: 'Bengaluru, India',
    links: [{ label: 'LinkedIn', url: 'linkedin.com/in/priyaraman' }],
  },
  headline: 'Senior frontend engineer',
  summary: 'Frontend engineer with seven years building fast, accessible React apps.',
  roles: [
    { id: 'r_bolt0001', title: 'Frontend Engineer', employer: 'Bolt Labs', location: 'Pune', start: '2019-07', end: '2022-02' },
    { id: 'r_acme0001', title: 'Senior Frontend Engineer', employer: 'Acme Payments', location: 'Bengaluru', start: '2022-03', end: null },
    { id: 'r_init0001', title: 'Software Engineer Intern', employer: 'Initech', location: null, start: '2018-01', end: '2018-06' },
  ],
  education: [
    { id: 'e_1', institution: 'Anna University', degree: 'B.Tech', field: 'Computer Science', end: '2019', grade: '8.6 CGPA' },
  ],
  certifications: [{ id: 'c_1', name: 'AWS Certified Developer – Associate', issuer: 'Amazon Web Services', year: '2023' }],
  projects: [{ id: 'p_1', name: 'Tiny Charts', url: 'github.com/priya/tiny-charts', factIds: ['f_proj0001'] }],
  skills: [
    { name: 'react', label: 'React', years: 6 },
    { name: 'typescript', label: 'TypeScript', years: 5 },
    { name: 'next.js', label: 'Next.js', years: 3 },
    { name: 'graphql', label: 'GraphQL', years: 2 },
    { name: 'accessibility', label: 'Accessibility', years: null },
    { name: 'aws', label: 'AWS', years: 2 },
  ],
  facts: [
    { id: 'f_acme0001', text: 'Cut checkout p95 latency from 900 ms to 250 ms by moving rendering to the edge', roleId: 'r_acme0001', skills: ['next.js', 'react'], confirmed: true },
    { id: 'f_acme0002', text: 'Led a team of 4 engineers rebuilding the merchant dashboard in React and TypeScript', roleId: 'r_acme0001', skills: ['react', 'typescript'], confirmed: true },
    { id: 'f_acme0003', text: 'Raised conversion 12% on the payment page, worth ₹1,20,00,000 a year', roleId: 'r_acme0001', skills: ['react'], confirmed: true },
    { id: 'f_bolt0001', text: 'Built a GraphQL client layer used by 2.5M monthly users', roleId: 'r_bolt0001', skills: ['graphql'], confirmed: true },
    { id: 'f_bolt0002', text: 'Brought the design system to WCAG 2.1 AA across 40 components', roleId: 'r_bolt0001', skills: ['accessibility'], confirmed: false },
    { id: 'f_proj0001', text: 'Open-source charting library with 3k GitHub stars', roleId: null, skills: ['typescript'], confirmed: true },
    { id: 'f_auth0001', text: 'Indian citizen, authorised to work in India', roleId: null, skills: [], confirmed: true },
  ],
  languages: ['English', 'Tamil'],
});

export const sampleSpec = (): CareerSpec => ({
  roles: ['Senior Frontend Engineer'],
  seniority: ['senior'],
  workModes: ['remote', 'hybrid'],
  locations: ['Bengaluru'],
  timezones: ['Asia/Kolkata'],
  salaryFloor: { amount: 3_000_000, currency: 'INR', period: 'year' },
  salaryTarget: { amount: 3_600_000, currency: 'INR', period: 'year' },
  companyStages: ['startup'],
  mustHaves: [],
  dealBreakers: [],
  noticeDays: 30,
  notes: 'Prefers product companies.',
});

export const sampleRequirements = (): Requirements => ({
  version: 1,
  mustHave: [{ skill: 'React', years: 4 }, { skill: 'TypeScript', years: 3 }, { skill: 'Kubernetes', years: null }],
  niceToHave: [{ skill: 'GraphQL', years: null }, { skill: 'Next.js', years: null }],
  minYears: 5,
  seniority: 'senior',
  education: null,
  locationPolicy: { mode: 'remote', where: ['India'] },
  timezones: [],
  salary: null,
  employmentType: 'full_time',
  visa: null,
  applyEmail: 'jobs@stripe.example',
  screeningQuestions: ['What is your notice period?', 'Why do you want to work at Stripe?'],
});

export const sampleDraft = (): TailoredDraft => ({
  headline: 'Senior Frontend Engineer, React and TypeScript',
  summary: { text: 'Frontend engineer who cut checkout latency from 900 ms to 250 ms.', factIds: ['f_acme0001'] },
  skills: ['react', 'typescript', 'graphql', 'next.js'],
  roles: [
    {
      roleId: 'r_acme0001',
      bullets: [
        { text: 'Cut checkout p95 latency from 900 ms to 250 ms by rendering at the edge', factIds: ['f_acme0001'] },
        { text: 'Led 4 engineers rebuilding the merchant dashboard in React and TypeScript', factIds: ['f_acme0002'] },
        { text: 'Lifted payment-page conversion by 12%, worth ₹1.2 Cr a year', factIds: ['f_acme0003'] },
      ],
    },
    {
      roleId: 'r_bolt0001',
      bullets: [{ text: 'Built the GraphQL client layer serving 2,500,000 monthly users', factIds: ['f_bolt0001'] }],
    },
  ],
  projects: [{ projectId: 'p_1', bullets: [{ text: 'Charting library with 3,000 GitHub stars', factIds: ['f_proj0001'] }] }],
});
