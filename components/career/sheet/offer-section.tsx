'use client';

import { useId, useState } from 'react';
import { Lightbulb, Save, Send } from 'lucide-react';
import { adviseOfferAction, saveOfferTermsAction, sendOfferReplyAction } from '@/app/career/actions';
import { BusyIcon, NoticeLine } from '@/components/career/bits';
import { moneyShort } from '@/components/career/format';
import { useRun } from '@/components/career/use-run';
import type { CareerOffer, OfferAdvice, OfferAsk, OfferTerms, SalaryPeriod } from '@/lib/career/types';
import type { ApplicationDetail } from '@/lib/career/view';

const EMPTY: OfferTerms = { fixed: null, variable: null, joiningBonus: null, equity: null, currency: 'INR', period: 'year', startDate: null, deadline: null };

const VERDICT: Record<OfferAdvice['verdict'], { word: string; line: string }> = {
  accept: { word: 'Accept', line: 'It’s a fair offer for your experience and the market.' },
  negotiate: { word: 'Negotiate', line: 'There’s room to ask for more, and good reason to.' },
  walk_away: { word: 'Walk away', line: 'It falls short of what you set as your floor.' },
};

const ASK_LABEL: Record<OfferAsk['item'], string> = {
  base: 'Base pay', joining_bonus: 'Joining bonus', notice_buyout: 'Notice buyout', equity: 'Equity', remote: 'Remote work',
  title: 'Title', start_date: 'Start date', learning_budget: 'Learning budget', other: 'Other',
};

type NumberKey = 'fixed' | 'variable' | 'joiningBonus';
const NUMBER_FIELDS: Array<[NumberKey, string]> = [['fixed', 'Fixed pay'], ['variable', 'Variable pay'], ['joiningBonus', 'Joining bonus']];

function NumberField({ label, value, currency, onChange }: Readonly<{ label: string; value: number | null; currency: string | null; onChange: (value: number | null) => void }>) {
  const id = useId();
  return (
    <label className="fd-field" htmlFor={id}>
      {label}
      <input id={id} inputMode="decimal" value={value ?? ''} onChange={(event) => {
        const raw = event.currentTarget.value.replaceAll(/[^\d.]/g, '');
        onChange(raw ? Number(raw) : null);
      }} />
      {value ? <span className="cr-field-hint">{moneyShort(value, currency ?? 'INR')}</span> : null}
    </label>
  );
}

function TextField({ label, value, onChange, type = 'text' }: Readonly<{ label: string; value: string | null; onChange: (value: string | null) => void; type?: string }>) {
  const id = useId();
  return (
    <label className="fd-field" htmlFor={id}>
      {label}
      <input id={id} type={type} value={value ?? ''} onChange={(event) => onChange(event.currentTarget.value || null)} />
    </label>
  );
}

/** The terms as parsed from the email, for the owner to confirm or correct before any advice. */
function TermsForm({ applicationId, offer, onDetail }: Readonly<{ applicationId: string; offer: CareerOffer | null; onDetail: (detail: ApplicationDetail) => void }>) {
  const [terms, setTerms] = useState<OfferTerms>(offer?.terms ?? EMPTY);
  const { busy, notice, run } = useRun();
  const set = <K extends keyof OfferTerms>(key: K, value: OfferTerms[K]) => setTerms((current) => ({ ...current, [key]: value }));
  const save = () => run('terms', () => saveOfferTermsAction(applicationId, terms), (detail) => {
    onDetail(detail);
    return 'Terms confirmed.';
  });
  const periodId = useId();
  return (
    <div className="cr-terms">
      <div className="fd-grid">
        {NUMBER_FIELDS.map(([key, label]) => <NumberField key={key} label={label} value={terms[key]} currency={terms.currency} onChange={(value) => set(key, value)} />)}
        <TextField label="Currency" value={terms.currency} onChange={(value) => set('currency', value?.toUpperCase() ?? null)} />
        <label className="fd-field" htmlFor={periodId}>
          Per
          <select id={periodId} value={terms.period ?? 'year'} onChange={(event) => set('period', event.currentTarget.value as SalaryPeriod)}>
            <option value="year">Year</option>
            <option value="month">Month</option>
            <option value="hour">Hour</option>
          </select>
        </label>
        <TextField label="Equity" value={terms.equity} onChange={(value) => set('equity', value)} />
        <TextField label="Start date" type="date" value={terms.startDate} onChange={(value) => set('startDate', value)} />
        <TextField label="Answer by" type="date" value={terms.deadline} onChange={(value) => set('deadline', value)} />
      </div>
      <div className="fd-act pf-act">
        <button type="button" onClick={save} disabled={busy !== null}>
          <BusyIcon on={busy === 'terms'}><Save size={14} aria-hidden="true" /></BusyIcon>
          {offer?.confirmed ? 'Save changes' : 'Confirm terms'}
        </button>
      </div>
      <NoticeLine notice={notice} />
    </div>
  );
}

/** The advisor's verdict, asks, risks and reply draft; the reply goes only on its Send. */
function AdviceView({ offerId, advice, onDetail }: Readonly<{ offerId: string; advice: OfferAdvice; onDetail: (detail: ApplicationDetail) => void }>) {
  const replyId = useId();
  const [reply, setReply] = useState(advice.replyDraft);
  const { busy, notice, run } = useRun();
  const verdict = VERDICT[advice.verdict];
  const send = () => run('reply', () => sendOfferReplyAction(offerId, reply.trim()), (detail) => {
    onDetail(detail);
    return 'Reply sent from your Gmail.';
  });
  return (
    <div className="cr-advice">
      <p className={`cr-advice-verdict v-${advice.verdict}`}><b>{verdict.word}</b><span>{verdict.line}</span></p>
      {advice.reasons.length > 0 && <ul className="cr-plain">{advice.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
      {advice.asks.length > 0 && (
        <>
          <h3 className="cr-sub">What to ask for</h3>
          <ul className="cr-asks">
            {advice.asks.map((ask) => (
              <li key={`${ask.item}-${ask.ask}`}>
                <small>{ASK_LABEL[ask.item]}</small>
                <b>{ask.ask}</b>
                <span>{ask.why}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {advice.capNote && <p className="fd-msg">{advice.capNote}</p>}
      {advice.risks.length > 0 && (
        <>
          <h3 className="cr-sub">Risks</h3>
          <ul className="cr-plain">{advice.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul>
        </>
      )}
      <label className="fd-field wide" htmlFor={replyId}>
        Reply to the recruiter
        <textarea id={replyId} rows={8} value={reply} onChange={(event) => setReply(event.currentTarget.value)} />
      </label>
      <div className="fd-act pf-act">
        <button type="button" onClick={send} disabled={busy !== null || reply.trim().length < 20}>
          <BusyIcon on={busy === 'reply'}><Send size={14} aria-hidden="true" /></BusyIcon>
          Send reply
        </button>
      </div>
      <NoticeLine notice={notice} />
    </div>
  );
}

/** An offer: confirm its terms, then ask for advice and send the reply. */
export function OfferSection({ applicationId, offer, onDetail }: Readonly<{ applicationId: string; offer: CareerOffer | null; onDetail: (detail: ApplicationDetail) => void }>) {
  const [advice, setAdvice] = useState<OfferAdvice | null>(offer?.advice ?? null);
  const { busy, notice, run } = useRun();
  const advise = () => {
    if (!offer) return;
    void run('advise', () => adviseOfferAction(offer.id), (next) => {
      setAdvice(next);
    });
  };
  return (
    <section className="cr-block cr-offer" aria-labelledby="cr-offer-title">
      <h2 className="fd-label" id="cr-offer-title">Offer</h2>
      <p className="cr-block-note">
        {offer?.confirmed ? 'Your confirmed terms. Change anything that’s off and save again.' : 'Check the terms Orbis read from the email. Advice waits until you confirm them.'}
      </p>
      <TermsForm
        applicationId={applicationId}
        offer={offer}
        onDetail={(detail) => {
          // Saving the terms clears the server's advice (saveOfferTermsAction): it was for the old terms.
          setAdvice(detail.offer?.advice ?? null);
          onDetail(detail);
        }}
      />
      {offer?.confirmed && !advice && (
        <div className="fd-act">
          <button type="button" onClick={advise} disabled={busy !== null}>
            <BusyIcon on={busy === 'advise'}><Lightbulb size={15} aria-hidden="true" /></BusyIcon>
            {busy === 'advise' ? 'Weighing it up…' : 'Get advice'}
          </button>
        </div>
      )}
      <NoticeLine notice={notice} />
      {offer && advice && <AdviceView key={advice.replyDraft} offerId={offer.id} advice={advice} onDetail={onDetail} />}
    </section>
  );
}
