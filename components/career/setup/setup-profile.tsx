'use client';

import { useId, useState } from 'react';
import { BadgeCheck, ChevronDown, Plus, Save, Trash2 } from 'lucide-react';
import { saveProfileAction } from '@/app/career/actions';
import { BusyIcon, NoticeLine } from '@/components/career/bits';
import { monthYear } from '@/components/career/format';
import { useRun } from '@/components/career/use-run';
import type { CareerContact, CareerFact, CareerProfile, CareerRole, CareerSkill } from '@/lib/career/types';

/** 'f_' + 8 base36 characters, the shape the profile's ids take. */
function newFactId() {
  const random = Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => (byte % 36).toString(36)).join('');
  return `f_${random}`;
}

function TextInput({ label, value, onChange, type = 'text' }: Readonly<{ label: string; value: string; onChange: (value: string) => void; type?: string }>) {
  const id = useId();
  return (
    <label className="fd-field" htmlFor={id}>
      {label}
      <input id={id} type={type} value={value} onChange={(event) => onChange(event.currentTarget.value)} />
    </label>
  );
}

function FactRow({ fact, onChange, onRemove }: Readonly<{ fact: CareerFact; onChange: (fact: CareerFact) => void; onRemove: () => void }>) {
  const id = useId();
  return (
    <li className={`cr-fact${fact.confirmed ? ' confirmed' : ''}`}>
      <label htmlFor={id} className="sr-only">Fact</label>
      <textarea id={id} rows={2} value={fact.text} onChange={(event) => onChange({ ...fact, text: event.currentTarget.value, confirmed: true })} />
      <div className="cr-fact-foot">
        {fact.confirmed
          ? <span className="cr-fact-ok"><BadgeCheck size={12} aria-hidden="true" />Confirmed</span>
          : <button type="button" className="fd-link" onClick={() => onChange({ ...fact, confirmed: true })}>Confirm as true</button>}
        <button type="button" className="cr-icon-btn" onClick={onRemove} aria-label="Remove this fact"><Trash2 size={13} aria-hidden="true" /></button>
      </div>
    </li>
  );
}

function FactList({ facts, roleId, onFacts }: Readonly<{ facts: CareerFact[]; roleId: string | null; onFacts: (update: (facts: CareerFact[]) => CareerFact[]) => void }>) {
  const mine = facts.filter((fact) => fact.roleId === roleId);
  const unconfirmed = mine.filter((fact) => !fact.confirmed).length;
  return (
    <>
      {unconfirmed > 0 && <p className="cr-field-hint">{unconfirmed} read from your resume and not yet confirmed. Tailoring only ever uses what’s here.</p>}
      <ul className="cr-facts">
        {mine.map((fact) => (
          <FactRow
            key={fact.id}
            fact={fact}
            onChange={(next) => onFacts((all) => all.map((item) => (item.id === fact.id ? next : item)))}
            onRemove={() => onFacts((all) => all.filter((item) => item.id !== fact.id))}
          />
        ))}
      </ul>
      <button type="button" className="fd-link cr-add" onClick={() => onFacts((all) => [...all, { id: newFactId(), text: '', roleId, skills: [], confirmed: true }])}>
        <Plus size={13} aria-hidden="true" />Add a fact
      </button>
    </>
  );
}

function RoleEditor({ role, facts, onRole, onFacts }: Readonly<{ role: CareerRole; facts: CareerFact[]; onRole: (role: CareerRole) => void; onFacts: (update: (facts: CareerFact[]) => CareerFact[]) => void }>) {
  const count = facts.filter((fact) => fact.roleId === role.id).length;
  return (
    <details className="cr-role">
      <summary>
        <span><b>{role.title || 'Untitled role'}</b><small>{role.employer}, {monthYear(role.start)} – {monthYear(role.end)}</small></span>
        <em>{count} {count === 1 ? 'fact' : 'facts'}<ChevronDown size={14} aria-hidden="true" /></em>
      </summary>
      <div className="fd-grid">
        <TextInput label="Title" value={role.title} onChange={(title) => onRole({ ...role, title })} />
        <TextInput label="Employer" value={role.employer} onChange={(employer) => onRole({ ...role, employer })} />
        <TextInput label="Started" type="month" value={role.start} onChange={(start) => onRole({ ...role, start })} />
        <TextInput label="Ended (blank if current)" type="month" value={role.end ?? ''} onChange={(end) => onRole({ ...role, end: end || null })} />
      </div>
      <h3 className="cr-sub">Facts</h3>
      <FactList facts={facts} roleId={role.id} onFacts={onFacts} />
    </details>
  );
}

function SkillsEditor({ skills, onSkills }: Readonly<{ skills: CareerSkill[]; onSkills: (skills: CareerSkill[]) => void }>) {
  const addId = useId();
  const [adding, setAdding] = useState('');
  const add = () => {
    const label = adding.trim();
    if (!label) return;
    onSkills([...skills, { name: label.toLowerCase(), label, years: null }]);
    setAdding('');
  };
  return (
    <>
      <ul className="cr-skills">
        {skills.map((skill, index) => (
          <li key={skill.name}>
            <span>{skill.label}</span>
            <label className="sr-only" htmlFor={`skill-years-${skill.name}`}>Years of {skill.label}</label>
            <input id={`skill-years-${skill.name}`} type="number" min={0} max={50} inputMode="numeric" value={skill.years ?? ''} placeholder="–" onChange={(event) => {
              const raw = event.currentTarget.value;
              onSkills(skills.map((item, at) => (at === index ? { ...item, years: raw === '' ? null : Math.round(Number(raw)) } : item)));
            }} />
            <small aria-hidden="true">yrs</small>
            <button type="button" className="cr-icon-btn" onClick={() => onSkills(skills.filter((_, at) => at !== index))} aria-label={`Remove ${skill.label}`}><Trash2 size={13} aria-hidden="true" /></button>
          </li>
        ))}
      </ul>
      <div className="cr-inline-add">
        <label htmlFor={addId} className="sr-only">Add a skill</label>
        <input id={addId} value={adding} placeholder="Add a skill" onChange={(event) => setAdding(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') add(); }} />
        <button type="button" className="pf-pill" onClick={add} disabled={!adding.trim()}>Add</button>
      </div>
      <p className="cr-field-hint">Orbis only counts a skill when a fact or role backs it.</p>
    </>
  );
}

/** The profile as Orbis read it: contact, roles with their facts, other facts and skills. */
export function SetupProfile({ profile, onSaved }: Readonly<{ profile: CareerProfile; onSaved: (profile: CareerProfile) => void }>) {
  const [draft, setDraft] = useState(profile);
  const [dirty, setDirty] = useState(false);
  const { busy, notice, run } = useRun();
  const change = (update: (current: CareerProfile) => CareerProfile) => {
    setDraft(update);
    setDirty(true);
  };
  const setContact = (patch: Partial<CareerContact>) => change((current) => ({ ...current, contact: { ...current.contact, ...patch } }));
  const onFacts = (update: (facts: CareerFact[]) => CareerFact[]) => change((current) => ({ ...current, facts: update(current.facts) }));
  const save = () => run('save', () => saveProfileAction({ ...draft, facts: draft.facts.filter((fact) => fact.text.trim()) }), (saved) => {
    setDraft(saved);
    setDirty(false);
    onSaved(saved);
    return 'Profile saved.';
  });

  return (
    <div className="cr-profile">
      <div className="fd-grid">
        <TextInput label="Name" value={draft.contact.name} onChange={(name) => setContact({ name })} />
        <TextInput label="Email" type="email" value={draft.contact.email} onChange={(email) => setContact({ email })} />
        <TextInput label="Phone" type="tel" value={draft.contact.phone ?? ''} onChange={(phone) => setContact({ phone: phone || null })} />
        <TextInput label="Location" value={draft.contact.location ?? ''} onChange={(location) => setContact({ location: location || null })} />
      </div>
      <div className="cr-one">
        <TextInput label="Headline" value={draft.headline ?? ''} onChange={(headline) => change((current) => ({ ...current, headline: headline || null }))} />
      </div>

      <h3 className="cr-sub">Roles</h3>
      {draft.roles.map((role) => (
        <RoleEditor
          key={role.id}
          role={role}
          facts={draft.facts}
          onRole={(next) => change((current) => ({ ...current, roles: current.roles.map((item) => (item.id === role.id ? next : item)) }))}
          onFacts={onFacts}
        />
      ))}

      <h3 className="cr-sub">Other facts</h3>
      <FactList facts={draft.facts} roleId={null} onFacts={onFacts} />

      <h3 className="cr-sub">Skills</h3>
      <SkillsEditor skills={draft.skills} onSkills={(skills) => change((current) => ({ ...current, skills }))} />

      <div className="fd-act pf-act">
        <button type="button" onClick={save} disabled={!dirty || busy !== null}>
          <BusyIcon on={busy === 'save'}><Save size={14} aria-hidden="true" /></BusyIcon>
          Save profile
        </button>
      </div>
      <NoticeLine notice={notice} />
    </div>
  );
}
