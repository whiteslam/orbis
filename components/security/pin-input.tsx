'use client';

import type { MouseEvent, ReactNode } from 'react';
import { Delete } from 'lucide-react';
import { PIN_LENGTH } from '@/lib/security/pin-rules';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

// A single numeric field drawn as six dots; calls onComplete as soon as the sixth digit is typed.
// With `keypad`, an on-screen number pad replaces the phone keyboard; a hardware keyboard still types into the field.
// `extraKey` fills the pad's bottom-left slot (e.g. the passkey button).
export function PinInput({ id, value, onChange, onComplete, disabled, autoFocus, describedBy, keypad = false, extraKey }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  describedBy?: string;
  keypad?: boolean;
  extraKey?: ReactNode;
}) {
  function update(next: string) {
    const digits = next.replace(/\D/g, '').slice(0, PIN_LENGTH);
    onChange(digits);
    if (digits.length === PIN_LENGTH) onComplete?.(digits);
  }

  // Keeps focus in the field while tapping keys, so typing on a keyboard keeps working.
  const keepFocus = (event: MouseEvent) => event.preventDefault();

  return (
    <>
      <div className={keypad ? 'pin-field keypad' : 'pin-field'}>
        <input
          id={id}
          className="pin-native"
          type="password"
          inputMode={keypad ? 'none' : 'numeric'}
          autoComplete="off"
          pattern="[0-9]*"
          maxLength={PIN_LENGTH}
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-describedby={describedBy}
          onChange={(event) => update(event.target.value)}
        />
        <div className="pin-dots" aria-hidden="true">
          {Array.from({ length: PIN_LENGTH }, (_, index) => <span key={index} className={index < value.length ? 'filled' : ''} />)}
        </div>
      </div>

      {keypad && (
        <div className="pin-pad">
          {KEYS.map((key) => (
            <button key={key} className="pin-key" type="button" onMouseDown={keepFocus} onClick={() => update(value + key)} disabled={disabled || value.length >= PIN_LENGTH}>{key}</button>
          ))}
          {extraKey ?? <span />}
          <button className="pin-key" type="button" onMouseDown={keepFocus} onClick={() => update(value + '0')} disabled={disabled || value.length >= PIN_LENGTH}>0</button>
          <button className="pin-key plain" type="button" onMouseDown={keepFocus} onClick={() => onChange(value.slice(0, -1))} disabled={disabled || !value} aria-label="Delete">
            <Delete size={22} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  );
}
