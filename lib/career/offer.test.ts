import { test } from 'vitest';
import assert from 'node:assert/strict';
import { annualise, buildOfferPrompt, capCounter, parseAmount, parseOfferReply, validateTerms } from './offer.ts';
import type { OfferAdvice, OfferTerms, SalaryPulse } from './types.ts';

const terms = (over: Partial<OfferTerms> = {}): OfferTerms => ({
  fixed: 1_800_000, variable: null, joiningBonus: null, equity: null, currency: 'INR', period: 'year', startDate: null, deadline: null, ...over,
});

const advice = (ask: string, draft = `Thank you! Could we get to ${ask}?`): OfferAdvice => ({
  verdict: 'negotiate', reasons: ['Below target.'], risks: [], replyDraft: draft, capNote: null,
  asks: [{ item: 'base', ask, why: 'Market.' }, { item: 'joining_bonus', ask: '₹5 lakh', why: 'Notice buyout.' }],
});

test('annualise uses the fixed pay and its period', () => {
  assert.equal(annualise(terms()), 1_800_000);
  assert.equal(annualise(terms({ fixed: 150_000, period: 'month' })), 1_800_000);
  assert.equal(annualise(terms({ period: null })), null);
  assert.equal(annualise(terms({ fixed: null })), null);
});

test('validateTerms is shared with the watcher', () => {
  assert.equal(validateTerms({ fixed: 1, currency: 'usd', period: 'year' })?.currency, 'USD');
});

test('parseAmount reads Indian and western styles', () => {
  assert.equal(parseAmount('₹24 LPA base')?.amount, 2_400_000);
  assert.equal(parseAmount('₹24 LPA base')?.period, 'year');
  const lakh = parseAmount('18 lakh per annum');
  assert.deepEqual([lakh?.amount, lakh?.currency, lakh?.period], [1_800_000, 'INR', 'year']);
  assert.equal(parseAmount('1.2 crore')?.amount, 12_000_000);
  assert.equal(parseAmount('Rs. 24,00,000 fixed')?.amount, 2_400_000);
  const dollars = parseAmount('$145k base');
  assert.deepEqual([dollars?.amount, dollars?.currency, dollars?.matched], [145_000, 'USD', '$145k']);
  const euros = parseAmount('€90,000 a year');
  assert.deepEqual([euros?.amount, euros?.currency, euros?.period], [90_000, 'EUR', 'year']);
  assert.equal(parseAmount('£5k a month')?.period, 'month');
  assert.equal(parseAmount('start in 2 weeks'), null);
  assert.equal(parseAmount('10% more'), null);
  assert.equal(parseAmount('after 10 months'), null);
  // "rs" inside a word isn't rupees.
  assert.equal(parseAmount('40 hours 50 days'), null);
});

test('a counter within 25% stands', () => {
  const out = capCounter(advice('₹22 LPA'), terms(), null, []);
  assert.equal(out.capNote, null);
  assert.equal(out.asks[0].ask, '₹22 LPA');
});

test('an unsupported counter is capped at 25%, and said aloud', () => {
  const out = capCounter(advice('₹30 LPA'), terms(), null, []);
  assert.equal(out.asks[0].ask, '₹22.5 LPA');
  assert.equal(out.replyDraft, 'Thank you! Could we get to ₹22.5 LPA?');
  assert.match(out.capNote ?? '', /from ₹30 LPA to ₹22.5 LPA: 25% over the offer/);
  assert.match(out.capNote ?? '', /reply draft was changed/);
  // Other asks are left alone.
  assert.equal(out.asks[1].ask, '₹5 lakh');
});

test('market p75 or a competing offer lifts the cap', () => {
  const pulse: SalaryPulse = { currency: 'INR', period: 'year', p25: 1_600_000, p50: 2_000_000, p75: 2_800_000, sample: 12 };
  const byMarket = capCounter(advice('₹30 LPA'), terms(), [pulse], []);
  assert.equal(byMarket.asks[0].ask, '₹28 LPA');
  assert.match(byMarket.capNote ?? '', /market's upper range or a competing offer supports/);
  const byOffer = capCounter(advice('₹30 LPA'), terms(), null, [3_200_000]);
  assert.equal(byOffer.capNote, null);
  // A pulse in another currency is no support.
  const usdPulse = { ...pulse, currency: 'USD' };
  assert.equal(capCounter(advice('₹30 LPA'), terms(), usdPulse, []).asks[0].ask, '₹22.5 LPA');
});

test('dollar counters and monthly offers', () => {
  const usd = terms({ fixed: 120_000, currency: 'USD' });
  const out = capCounter(advice('$170k base', 'Hoping for 170k.'), usd, null, []);
  assert.equal(out.asks[0].ask, '$150k base');
  assert.match(out.capNote ?? '', /Check the reply draft/);
  const monthly = terms({ fixed: 150_000, period: 'month' });
  const full = capCounter(advice('₹2,50,000 a month'), monthly, null, []);
  assert.equal(full.asks[0].ask, '₹1,87,500 a month');
});

test('an offer with unknown pay is left alone', () => {
  const original = advice('₹90 LPA');
  assert.equal(capCounter(original, terms({ fixed: null }), null, []), original);
});

test('the prompt carries the numbers and the guard', () => {
  const prompt = buildOfferPrompt({
    terms: terms(), spec: { salaryFloor: { amount: 1_500_000, currency: 'INR', period: 'year' }, salaryTarget: null, noticeDays: 60, notes: null },
    profileSummary: 'Senior frontend engineer, 7 years.', pulse: null, competing: [{ company: 'Bolt', stage: 'interview', annual: null, currency: null }],
  });
  assert.match(prompt.system, /25% over the offer/);
  assert.match(prompt.user, /Fixed per year: INR 1800000/);
  assert.match(prompt.user, /Bolt: interview/);
  assert.match(prompt.user, /Notice period: 60 days/);
});

test('parseOfferReply', () => {
  const parsed = parseOfferReply(JSON.stringify({
    verdict: 'negotiate', reasons: ['Below target', ''], risks: ['Tight deadline'], replyDraft: 'Hi Priya, ...',
    asks: [{ item: 'base', ask: '₹22 LPA', why: 'p75' }, { item: 'pony', ask: 'A pony' }, { item: 'title', ask: '' }],
  }));
  assert.deepEqual(parsed, {
    verdict: 'negotiate', reasons: ['Below target'], risks: ['Tight deadline'], replyDraft: 'Hi Priya, ...', capNote: null,
    asks: [{ item: 'base', ask: '₹22 LPA', why: 'p75' }, { item: 'other', ask: 'A pony', why: '' }],
  });
  assert.equal(parseOfferReply(JSON.stringify({ verdict: 'maybe', reasons: ['x'], replyDraft: 'y' })), null);
  assert.equal(parseOfferReply(JSON.stringify({ verdict: 'accept', reasons: [], replyDraft: 'y' })), null);
  assert.equal(parseOfferReply('nope'), null);
});
