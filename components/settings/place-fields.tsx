'use client';

import { useMemo } from 'react';
import { canonicalTimeZone, type ModuleId } from '@/lib/locale/person';
import { currencyOptions, timeZoneOptions } from '@/lib/locale/options';
import { MODULES } from '@/lib/shell/modules';

// Shared by onboarding and Settings → Region and Tabs, so the two ask the same way.

/** Every time zone, as a plain list; the server checks the choice again. */
export function TimeZoneSelect({ id, value, onChange, disabled }: Readonly<{ id: string; value: string; onChange: (value: string) => void; disabled?: boolean }>) {
  // By its current name, which is always one of the options (an old name like Asia/Calcutta is not).
  const zone = canonicalTimeZone(value);
  const zones = useMemo(() => timeZoneOptions(zone), [zone]);
  return (
    <label className="fd-field wide" htmlFor={id}>Time zone
      <select id={id} value={zone} onChange={(event) => onChange(event.currentTarget.value)} disabled={disabled}>
        {zones.map((option) => <option key={option} value={option}>{option.replaceAll('_', ' ')}</option>)}
      </select>
    </label>
  );
}

/** Every currency, the common ones first, named in the person's own language. */
export function CurrencySelect({ id, value, onChange, disabled, locale }: Readonly<{ id: string; value: string; onChange: (value: string) => void; disabled?: boolean; locale: string }>) {
  const options = useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames([locale], { type: 'currency' });
    } catch {
      names = null;
    }
    return currencyOptions().map((code) => ({ code, name: names?.of(code) ?? code }));
  }, [locale]);
  return (
    <label className="fd-field wide" htmlFor={id}>Currency
      <select id={id} value={value} onChange={(event) => onChange(event.currentTarget.value)} disabled={disabled}>
        {options.map(({ code, name }) => <option key={code} value={code}>{name === code ? code : `${code} · ${name}`}</option>)}
      </select>
    </label>
  );
}

/** A checkbox per module. Today isn't one: it is always there. */
export function ModuleChoices({ idPrefix, value, onChange, disabled }: Readonly<{ idPrefix: string; value: ModuleId[]; onChange: (value: ModuleId[]) => void; disabled?: boolean }>) {
  const toggle = (id: ModuleId, on: boolean) => onChange(MODULES.map((m) => m.id).filter((m) => (m === id ? on : value.includes(m))));
  return (
    <fieldset className="ob-modules">
      <legend className="fd-label">Tabs to show</legend>
      {MODULES.map((module) => (
        <label key={module.id} className="fd-check fd-toggle" htmlFor={`${idPrefix}-${module.id}`}>
          <input id={`${idPrefix}-${module.id}`} type="checkbox" checked={value.includes(module.id)} onChange={(event) => toggle(module.id, event.currentTarget.checked)} disabled={disabled} />
          <span><strong>{module.label}</strong><small>{module.detail}</small></span>
        </label>
      ))}
      <p className="fd-note tight">Today is always there. Turning a tab off only hides it. Change this any time in Settings → Tabs.</p>
    </fieldset>
  );
}
