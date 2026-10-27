'use client';

import { useId, useState } from 'react';

/** A list typed as one comma-separated line ("React, TypeScript"); parsed when the field is left. */
export function ListField({ label, value, onChange, placeholder, hint }: Readonly<{ label: string; value: string[]; onChange: (value: string[]) => void; placeholder?: string; hint?: string }>) {
  const id = useId();
  const [text, setText] = useState(value.join(', '));
  const [seen, setSeen] = useState(value);
  // A new value from outside (a parsed sentence) replaces what's typed.
  if (seen !== value) {
    setSeen(value);
    setText(value.join(', '));
  }
  const commit = () => onChange(text.split(',').map((item) => item.trim()).filter(Boolean));
  return (
    <label className="fd-field wide" htmlFor={id}>
      {label}
      <input id={id} value={text} placeholder={placeholder} onChange={(event) => setText(event.currentTarget.value)} onBlur={commit} />
      {hint && <span className="cr-field-hint">{hint}</span>}
    </label>
  );
}

/** A whole number within bounds; empty means null. */
export function WholeField({ label, value, onChange, min, max, suffix }: Readonly<{ label: string; value: number | null; onChange: (value: number | null) => void; min?: number; max?: number; suffix?: string }>) {
  const id = useId();
  return (
    <label className="fd-field" htmlFor={id}>
      {label}
      <span className="cr-suffixed">
        <input id={id} type="number" inputMode="numeric" min={min} max={max} value={value ?? ''} onChange={(event) => {
          const raw = event.currentTarget.value;
          onChange(raw === '' ? null : Math.round(Number(raw)));
        }} />
        {suffix && <span aria-hidden="true">{suffix}</span>}
      </span>
    </label>
  );
}

/** A set of on/off chips, each a real toggle button. */
export function ChipSet<T extends string>({ label, options, value, onChange }: Readonly<{ label: string; options: ReadonlyArray<readonly [T, string]>; value: T[]; onChange: (value: T[]) => void }>) {
  return (
    <fieldset className="fd-chips cr-chipset">
      <legend className="fd-field">{label}</legend>
      <div>
        {options.map(([id, text]) => {
          const on = value.includes(id);
          return (
            <button key={id} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((item) => item !== id) : [...value, id])}>{text}</button>
          );
        })}
      </div>
    </fieldset>
  );
}
