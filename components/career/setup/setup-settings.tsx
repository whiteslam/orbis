'use client';

import { useId, useState } from 'react';
import { CircleCheck, CircleDashed, Mail, Plus, Save, Trash2 } from 'lucide-react';
import { saveSettingsAction } from '@/app/career/actions';
import { BusyIcon, NoticeLine } from '@/components/career/bits';
import { WholeField } from '@/components/career/fields';
import { SOURCE_CREDIT, SOURCE_NAME, SOURCE_NOTE } from '@/components/career/format';
import { useRun } from '@/components/career/use-run';
import { SOURCE_IDS, type CareerSettings, type WatchedCompany } from '@/lib/career/types';

const ATS: ReadonlyArray<readonly [WatchedCompany['ats'], string]> = [['greenhouse', 'Greenhouse'], ['lever', 'Lever'], ['ashby', 'Ashby'], ['recruitee', 'Recruitee']];

function SaveRow({ dirty, busy, onSave, label }: Readonly<{ dirty: boolean; busy: boolean; onSave: () => void; label: string }>) {
  return (
    <div className="fd-act pf-act">
      <button type="button" onClick={onSave} disabled={!dirty || busy}>
        <BusyIcon on={busy}><Save size={14} aria-hidden="true" /></BusyIcon>
        {label}
      </button>
    </div>
  );
}

function WatchAdd({ onAdd }: Readonly<{ onAdd: (company: WatchedCompany) => void }>) {
  const atsId = useId();
  const slugId = useId();
  const nameId = useId();
  const [ats, setAts] = useState<WatchedCompany['ats']>('greenhouse');
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const add = () => {
    const cleanSlug = slug.trim().toLowerCase();
    if (!cleanSlug) return;
    onAdd({ ats, slug: cleanSlug, name: name.trim() || cleanSlug });
    setSlug('');
    setName('');
  };
  return (
    <div className="cr-watch-add">
      <label className="fd-field" htmlFor={atsId}>
        Hires through
        <select id={atsId} value={ats} onChange={(event) => setAts(event.currentTarget.value as WatchedCompany['ats'])}>
          {ATS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      <label className="fd-field" htmlFor={slugId}>
        Board name
        <input id={slugId} value={slug} placeholder="stripe" onChange={(event) => setSlug(event.currentTarget.value)} />
      </label>
      <label className="fd-field" htmlFor={nameId}>
        Company
        <input id={nameId} value={name} placeholder="Stripe" onChange={(event) => setName(event.currentTarget.value)} />
      </label>
      <button type="button" className="pf-pill primary" onClick={add} disabled={!slug.trim()}><Plus size={12} aria-hidden="true" />Add</button>
      <p className="cr-field-hint">The board name is the part of their careers link after the domain: boards.greenhouse.io/<b>stripe</b>, jobs.lever.co/<b>netflix</b>.</p>
    </div>
  );
}

/** Each source on or off, with the credit it is shown under, and the company watchlist. */
export function SetupSources({ settings, onSaved }: Readonly<{ settings: CareerSettings; onSaved: (settings: CareerSettings) => void }>) {
  const [sources, setSources] = useState(settings.sources);
  const [watchlist, setWatchlist] = useState(settings.watchlist);
  const [dirty, setDirty] = useState(false);
  const { busy, notice, run } = useRun();
  const save = () => run('save', () => saveSettingsAction({ sources, watchlist }), (saved) => {
    setDirty(false);
    onSaved(saved);
    return 'Sources saved.';
  });
  const toggle = (id: (typeof SOURCE_IDS)[number]) => {
    setSources((current) => ({ ...current, [id]: !current[id] }));
    setDirty(true);
  };
  return (
    <>
      <ul className="cr-sources">
        {SOURCE_IDS.filter((id) => id !== 'pasted').map((id) => (
          <li key={id}>
            <label className="cr-source">
              <span><b>{SOURCE_NAME[id]}</b><small>{SOURCE_NOTE[id]}</small><em>Shown as “{SOURCE_CREDIT[id]}”</em></span>
              <input type="checkbox" role="switch" checked={sources[id]} onChange={() => toggle(id)} />
            </label>
          </li>
        ))}
      </ul>
      <h3 className="cr-sub">Company watchlist</h3>
      <p className="cr-field-hint">Companies whose own job boards Orbis checks directly.</p>
      {watchlist.length > 0 && (
        <ul className="cr-watch">
          {watchlist.map((company) => (
            <li key={`${company.ats}-${company.slug}`}>
              <span><b>{company.name}</b><small>{ATS.find(([id]) => id === company.ats)?.[1]}: {company.slug}</small></span>
              <button type="button" className="cr-icon-btn" aria-label={`Remove ${company.name}`} onClick={() => { setWatchlist((list) => list.filter((item) => item !== company)); setDirty(true); }}><Trash2 size={13} aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      )}
      <WatchAdd onAdd={(company) => { setWatchlist((list) => [...list.filter((item) => !(item.ats === company.ats && item.slug === company.slug)), company]); setDirty(true); }} />
      <SaveRow dirty={dirty} busy={busy === 'save'} onSave={save} label="Save sources" />
      <NoticeLine notice={notice} />
    </>
  );
}

type Numbers = Pick<CareerSettings, 'threshold' | 'dailySendCap' | 'weeklyGoal' | 'followUpDays' | 'ghostDays'>;

/** The bar, the caps and the timings. */
export function SetupNumbers({ settings, onSaved }: Readonly<{ settings: CareerSettings; onSaved: (settings: CareerSettings) => void }>) {
  const barId = useId();
  const [values, setValues] = useState<Numbers>({ threshold: settings.threshold, dailySendCap: settings.dailySendCap, weeklyGoal: settings.weeklyGoal, followUpDays: settings.followUpDays, ghostDays: settings.ghostDays });
  const [dirty, setDirty] = useState(false);
  const { busy, notice, run } = useRun();
  const set = (key: keyof Numbers, value: number | null) => {
    setValues((current) => ({ ...current, [key]: value ?? current[key] }));
    setDirty(true);
  };
  const save = () => run('save', () => saveSettingsAction(values), (saved) => {
    setDirty(false);
    onSaved(saved);
    return 'Settings saved.';
  });
  return (
    <>
      <label className="fd-field cr-bar" htmlFor={barId}>
        <span className="cr-bar-head">Your bar <output htmlFor={barId}>{values.threshold}</output></span>
        <input id={barId} type="range" min={30} max={90} step={5} value={values.threshold} onChange={(event) => set('threshold', Number(event.currentTarget.value))} />
        <span className="cr-field-hint">Jobs scoring this or more show in For you and get a drafted application. The rest stay in Everything.</span>
      </label>
      <div className="fd-grid">
        <WholeField label="Sends a day, at most" value={values.dailySendCap} onChange={(value) => set('dailySendCap', value)} min={1} max={100} />
        <WholeField label="Weekly goal" value={values.weeklyGoal} onChange={(value) => set('weeklyGoal', value)} min={1} max={100} />
        <WholeField label="Follow up after" value={values.followUpDays} onChange={(value) => set('followUpDays', value)} min={1} max={60} suffix="days" />
        <WholeField label="No reply after" value={values.ghostDays} onChange={(value) => set('ghostDays', value)} min={7} max={90} suffix="days" />
      </div>
      <SaveRow dirty={dirty} busy={busy === 'save'} onSave={save} label="Save settings" />
      <NoticeLine notice={notice} />
    </>
  );
}

/** The Gmail connection, and the one permission Career adds to it, explained before it's asked for. */
export function SetupGmail({ gmail }: Readonly<{ gmail: { connected: boolean; canSend: boolean } }>) {
  let state = { icon: <CircleDashed size={16} aria-hidden="true" />, title: 'Gmail isn’t connected', body: 'Connect it in Settings to read job alerts and replies.' };
  if (gmail.connected && gmail.canSend) state = { icon: <CircleCheck size={16} aria-hidden="true" />, title: 'Reading and sending', body: 'Orbis reads job alerts and replies, and sends the applications you press Send on.' };
  else if (gmail.connected) state = { icon: <CircleCheck size={16} aria-hidden="true" />, title: 'Reading only', body: 'Orbis reads job alerts and replies. Email applications open as a ready Gmail draft for you to send.' };
  return (
    <>
      <p className={`cr-gmail ${gmail.connected ? 'on' : 'off'}`}>{state.icon}<span><b>{state.title}</b><small>{state.body}</small></span></p>
      {gmail.connected && !gmail.canSend && (
        <div className="cr-allow">
          <p>Allowing sending adds one Google permission: sending email as you. Orbis uses it only to send an application, a follow-up or an offer reply after you press Send on that item, from your own address, and nothing else. It never sends on a schedule or on its own. You can turn it off from your Google account at any time.</p>
          <a className="fd-button" href="/auth/gmail/start?send=1"><Mail size={14} aria-hidden="true" />Allow sending applications</a>
        </div>
      )}
    </>
  );
}
