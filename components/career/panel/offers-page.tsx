'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { moneyShort, periodWord } from '@/components/career/format';
import { OfferSection } from '@/components/career/sheet/offer-section';
import { StatusChip } from '@/components/career/status-chip';
import { useRun } from '@/components/career/use-run';
import { PanelEmpty } from '@/components/career/panel/panel-bits';
import { usePanel } from '@/components/career/panel/panel-context';
import { allApplications } from '@/components/career/panel/panel-data';
import type { OfferTerms, SalaryPulse } from '@/lib/career/types';
import type { ApplicationCard, ApplicationDetail, CareerHome } from '@/lib/career/view';

const OFFER_STATES = new Set(['offer', 'accepted', 'declined']);

/** Fixed, variable and joining bonus; the first year is their sum. */
function Breakdown({ terms }: Readonly<{ terms: OfferTerms | null }>) {
  if (!terms || terms.fixed === null) {
    return <p className="cp-quiet">The pay isn’t confirmed yet. Check what Orbis read from the email below, then confirm it.</p>;
  }
  const currency = terms.currency ?? 'INR';
  const first = (terms.fixed ?? 0) + (terms.variable ?? 0) + (terms.joiningBonus ?? 0);
  const rows: Array<[string, number | null]> = [['Fixed', terms.fixed], ['Variable', terms.variable], ['Joining bonus', terms.joiningBonus]];
  return (
    <div className="cp-comp">
      <p className="cp-comp-total"><b>{moneyShort(first, currency)}</b><span>{terms.period === 'year' || !terms.period ? 'in the first year, all in' : `all in, ${periodWord(terms.period)}`}</span></p>
      <div className="cp-comp-bar" aria-hidden="true">
        {rows.filter(([, value]) => value).map(([label, value]) => <span key={label} className={`cp-comp-${label.split(' ')[0].toLowerCase()}`} style={{ flexGrow: value ?? 0 }} />)}
      </div>
      <dl className="cp-comp-rows">
        {rows.map(([label, value]) => (
          <div key={label}><dt><i className={`cp-comp-${label.split(' ')[0].toLowerCase()}`} aria-hidden="true" />{label}</dt><dd>{value ? moneyShort(value, currency) : 'None'}</dd></div>
        ))}
        <div><dt>Equity</dt><dd>{terms.equity ?? 'None'}</dd></div>
        {terms.startDate && <div><dt>Start</dt><dd>{terms.startDate}</dd></div>}
        {terms.deadline && <div><dt>Answer by</dt><dd>{terms.deadline}</dd></div>}
      </dl>
    </div>
  );
}

function at(value: number, low: number, high: number) {
  return `${Math.max(0, Math.min(100, ((value - low) / (high - low || 1)) * 100))}%`;
}

/** The offer's fixed pay against p25, the median and p75 of listings in the same currency and period. */
function MarketCompare({ terms, salary }: Readonly<{ terms: OfferTerms | null; salary: SalaryPulse[] }>) {
  const fixed = terms?.fixed ?? null;
  const pulse = salary.find((item) => item.currency.toUpperCase() === (terms?.currency ?? 'INR').toUpperCase() && item.period === (terms?.period ?? 'year')) ?? null;
  if (fixed === null) return null;
  if (!pulse) return <p className="cp-quiet">No listings in {terms?.currency ?? 'this currency'} {periodWord(terms?.period ?? 'year')} to compare with yet.</p>;
  const low = Math.min(pulse.p25, fixed) * 0.85;
  const high = Math.max(pulse.p75, fixed) * 1.1;
  const show = (value: number) => moneyShort(value, pulse.currency);
  let verdict = 'inside the middle half of listings';
  if (fixed < pulse.p25) verdict = 'below three in four listings';
  else if (fixed > pulse.p75) verdict = 'above three in four listings';
  return (
    <div className="cp-market">
      <h3 className="cp-sub">Against the market</h3>
      <p className="cp-market-line">Fixed pay of <b>{show(fixed)}</b> is {verdict}.</p>
      <div className="cp-market-strip" role="img" aria-label={`Listings pay ${show(pulse.p25)} to ${show(pulse.p75)}, median ${show(pulse.p50)}. This offer: ${show(fixed)}.`}>
        <span className="cp-market-band" style={{ left: at(pulse.p25, low, high), right: `calc(100% - ${at(pulse.p75, low, high)})` }} />
        <span className="cp-market-tick p25" style={{ left: at(pulse.p25, low, high) }}><small>p25 {show(pulse.p25)}</small></span>
        <span className="cp-market-tick p50" style={{ left: at(pulse.p50, low, high) }}><small>Median {show(pulse.p50)}</small></span>
        <span className="cp-market-tick p75" style={{ left: at(pulse.p75, low, high) }}><small>p75 {show(pulse.p75)}</small></span>
        <span className="cp-market-offer" style={{ left: at(fixed, low, high) }}><small>This offer</small></span>
      </div>
      <p className="cp-foot-note">
        From {pulse.sample} {pulse.sample === 1 ? 'listing' : 'listings'} that state pay for your role{pulse.sample < 10 ? '. That’s too few to lean on; treat it as a rough guide' : ''}.
      </p>
    </div>
  );
}

function OfferCard({ card, salary }: Readonly<{ card: ApplicationCard; salary: SalaryPulse[] }>) {
  const { openJob, reload, services } = usePanel();
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const { busy, notice, run } = useRun();
  useEffect(() => {
    void run('load', () => services.detail(card.job.id), setDetail);
  }, [card.job.id, run, services]);
  const offer = detail?.offer ?? null;
  const update = (next: ApplicationDetail) => {
    setDetail(next);
    reload();
  };
  return (
    <article className="cp-card-box cp-offer" aria-labelledby={`cp-offer-${card.application.id}`}>
      <header className="cp-offer-head">
        <div>
          <h2 id={`cp-offer-${card.application.id}`}>{card.job.company}</h2>
          <p>{card.job.title}</p>
        </div>
        <StatusChip status={card.application.status} />
        <button type="button" className="cp-link" onClick={() => openJob(card.job, card)}>Application<ArrowUpRight size={14} aria-hidden="true" /></button>
      </header>
      {busy === 'load' && <output className="cp-quiet">Loading the offer…</output>}
      {notice && !notice.ok && <p className="cp-quiet-error">The offer’s details didn’t load: {notice.text} You can still enter the terms by hand.</p>}
      <div className="cp-offer-body">
        <div className="cp-offer-facts">
          <h3 className="cp-sub">Compensation</h3>
          <Breakdown terms={offer?.terms ?? null} />
          <MarketCompare terms={offer?.terms ?? null} salary={salary} />
        </div>
        <div className="cp-offer-advice">
          {busy !== 'load' && <OfferSection key={offer?.id ?? 'none'} applicationId={card.application.id} offer={offer} replyTo={detail?.offerReplyTo ?? null} onDetail={update} />}
        </div>
      </div>
    </article>
  );
}

/** Offers: each with its pay broken down, set against the market, and the advisor beside it. */
export function OffersPage({ home }: Readonly<{ home: CareerHome }>) {
  const offers = allApplications(home).filter((card) => OFFER_STATES.has(card.application.status));
  if (offers.length === 0) {
    return <PanelEmpty title="No offers yet.">When an offer email arrives, it lands here with its pay broken down, how it compares with the market, and advice on what to ask for.</PanelEmpty>;
  }
  const salary = home.insights?.salary ?? [];
  return <div className="cp-offers">{offers.map((card) => <OfferCard key={card.application.id} card={card} salary={salary} />)}</div>;
}
