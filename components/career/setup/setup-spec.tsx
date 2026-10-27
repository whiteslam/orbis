'use client';

import { useId, useState } from 'react';
import { Save, Sparkles } from 'lucide-react';
import { saveSpecAction, specFromSentenceAction } from '@/app/career/actions';
import { BusyIcon, NoticeLine } from '@/components/career/bits';
import { ChipSet, ListField, WholeField } from '@/components/career/fields';
import { moneyShort, periodWord } from '@/components/career/format';
import { useRun } from '@/components/career/use-run';
import type { CareerSpec, Money, SalaryPeriod, Seniority, WorkMode } from '@/lib/career/types';

const EMPTY_SPEC: CareerSpec = {
  roles: [], seniority: [], workModes: [], locations: [], timezones: [], salaryFloor: null, salaryTarget: null,
  companyStages: [], mustHaves: [], dealBreakers: [], noticeDays: null, notes: null,
};

const SENIORITY: ReadonlyArray<readonly [Seniority, string]> = [
  ['junior', 'Junior'], ['mid', 'Mid'], ['senior', 'Senior'], ['lead', 'Lead'], ['principal', 'Principal'], ['manager', 'Manager'], ['director', 'Director'],
];
const MODES: ReadonlyArray<readonly [WorkMode, string]> = [['remote', 'Remote'], ['hybrid', 'Hybrid'], ['onsite', 'On-site']];

function MoneyField({ label, value, onChange }: Readonly<{ label: string; value: Money | null; onChange: (value: Money | null) => void }>) {
  const amountId = useId();
  const currencyId = useId();
  const periodId = useId();
  const base: Money = value ?? { amount: 0, currency: 'INR', period: 'year' };
  return (
    <fieldset className="cr-money">
      <legend className="fd-field">{label}</legend>
      <div>
        <label htmlFor={currencyId} className="sr-only">{label} currency</label>
        <select id={currencyId} value={base.currency} onChange={(event) => onChange({ ...base, currency: event.currentTarget.value })}>
          {['INR', 'USD', 'EUR', 'GBP', 'SGD', 'AUD', 'CAD'].map((code) => <option key={code} value={code}>{code}</option>)}
        </select>
        <label htmlFor={amountId} className="sr-only">{label} amount</label>
        <input id={amountId} inputMode="numeric" value={value ? String(value.amount) : ''} placeholder="Amount" onChange={(event) => {
          const raw = event.currentTarget.value.replaceAll(/\D/g, '');
          onChange(raw ? { ...base, amount: Number(raw) } : null);
        }} />
        <label htmlFor={periodId} className="sr-only">{label} per</label>
        <select id={periodId} value={base.period} onChange={(event) => onChange({ ...base, period: event.currentTarget.value as SalaryPeriod })}>
          <option value="year">a year</option>
          <option value="month">a month</option>
          <option value="hour">an hour</option>
        </select>
      </div>
      {value && value.amount > 0 && <span className="cr-field-hint">{moneyShort(value.amount, value.currency)} {periodWord(value.period)}</span>}
    </fieldset>
  );
}

/** "Describe it in a sentence": the AI turns it into fields to review, never saved until the owner saves. */
function Sentence({ onSpec }: Readonly<{ onSpec: (spec: CareerSpec) => void }>) {
  const id = useId();
  const [sentence, setSentence] = useState('');
  const { busy, notice, run } = useRun();
  const read = () => run('sentence', () => specFromSentenceAction(sentence.trim()), (spec) => {
    onSpec(spec);
    return 'Filled in below. Check each field, then save.';
  });
  return (
    <div className="cr-sentence">
      <label className="fd-field" htmlFor={id}>
        Describe it in a sentence
        <textarea id={id} rows={3} value={sentence} placeholder="Remote senior React roles above 30 LPA, product startups, no crypto" onChange={(event) => setSentence(event.currentTarget.value)} />
      </label>
      <div className="fd-act pf-act">
        <button type="button" onClick={read} disabled={busy !== null || sentence.trim().length < 8}>
          <BusyIcon on={busy === 'sentence'}><Sparkles size={14} aria-hidden="true" /></BusyIcon>
          Fill in the fields
        </button>
      </div>
      <NoticeLine notice={notice} />
    </div>
  );
}

/** What the owner is looking for: a sentence to start, then every field to check and edit. */
export function SetupSpec({ spec, onSaved }: Readonly<{ spec: CareerSpec | null; onSaved: (spec: CareerSpec) => void }>) {
  const notesId = useId();
  const [draft, setDraft] = useState<CareerSpec>(spec ?? EMPTY_SPEC);
  const [dirty, setDirty] = useState(false);
  const { busy, notice, run } = useRun();
  const set = <K extends keyof CareerSpec>(key: K, value: CareerSpec[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };
  const save = () => run('save', () => saveSpecAction(draft), (saved) => {
    setDraft(saved);
    setDirty(false);
    onSaved(saved);
    return 'Spec saved. The next search uses it.';
  });

  return (
    <div className="cr-spec">
      <Sentence onSpec={(next) => { setDraft(next); setDirty(true); }} />
      <ListField label="Roles" value={draft.roles} onChange={(value) => set('roles', value)} placeholder="Frontend engineer, React developer" />
      <ChipSet label="Seniority" options={SENIORITY} value={draft.seniority} onChange={(value) => set('seniority', value)} />
      <ChipSet label="Work" options={MODES} value={draft.workModes} onChange={(value) => set('workModes', value)} />
      <ListField label="Locations" value={draft.locations} onChange={(value) => set('locations', value)} placeholder="Bengaluru, India" hint="Where hybrid or on-site work is fine, and where you can work remotely from." />
      <ListField label="Time zones" value={draft.timezones} onChange={(value) => set('timezones', value)} placeholder="Asia/Kolkata, Europe/London" />
      <MoneyField label="Salary floor" value={draft.salaryFloor} onChange={(value) => set('salaryFloor', value)} />
      <MoneyField label="Salary target" value={draft.salaryTarget} onChange={(value) => set('salaryTarget', value)} />
      <ListField label="Company stage" value={draft.companyStages} onChange={(value) => set('companyStages', value)} placeholder="startup, scaleup" />
      <ListField label="Must-haves" value={draft.mustHaves} onChange={(value) => set('mustHaves', value)} placeholder="Product company, TypeScript" />
      <ListField label="Deal-breakers" value={draft.dealBreakers} onChange={(value) => set('dealBreakers', value)} placeholder="crypto, gambling" hint="A word here in a title or a hard requirement hides the job." />
      <div className="fd-grid">
        <WholeField label="Notice period" value={draft.noticeDays} onChange={(value) => set('noticeDays', value)} min={0} max={180} suffix="days" />
      </div>
      <label className="fd-field wide" htmlFor={notesId}>
        Anything else for the tone
        <textarea id={notesId} rows={3} value={draft.notes ?? ''} onChange={(event) => set('notes', event.currentTarget.value || null)} />
      </label>
      <div className="fd-act pf-act">
        <button type="button" onClick={save} disabled={!dirty || busy !== null || draft.roles.length === 0}>
          <BusyIcon on={busy === 'save'}><Save size={14} aria-hidden="true" /></BusyIcon>
          Save spec
        </button>
        {draft.roles.length === 0 && <span className="fd-hint">Add at least one role.</span>}
      </div>
      <NoticeLine notice={notice} />
    </div>
  );
}
