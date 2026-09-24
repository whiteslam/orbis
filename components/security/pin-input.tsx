'use client';

import { PIN_LENGTH } from '@/lib/security/pin-rules';

// A single numeric field drawn as six dots; calls onComplete as soon as the sixth digit is typed.
export function PinInput({ id, value, onChange, onComplete, disabled, autoFocus, describedBy }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  describedBy?: string;
}) {
  return (
    <div className="pin-field">
      <input
        id={id}
        className="pin-native"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]*"
        maxLength={PIN_LENGTH}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-describedby={describedBy}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH);
          onChange(digits);
          if (digits.length === PIN_LENGTH) onComplete?.(digits);
        }}
      />
      <div className="pin-dots" aria-hidden="true">
        {Array.from({ length: PIN_LENGTH }, (_, index) => <span key={index} className={index < value.length ? 'filled' : ''} />)}
      </div>
    </div>
  );
}
