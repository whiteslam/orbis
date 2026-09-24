// PIN format and strength rules, shared by the browser (PIN input) and the server.

export const PIN_LENGTH = 6;
export const MAX_PIN_ATTEMPTS = 5;

function isStraight(pin: string, step: 1 | -1) {
  for (let index = 1; index < pin.length; index += 1) {
    if (Number(pin[index]) !== (Number(pin[index - 1]) + step + 10) % 10) return false;
  }
  return true;
}

export function isPinFormat(pin: unknown): pin is string {
  return typeof pin === 'string' && pin.length === PIN_LENGTH && /^\d+$/.test(pin);
}

// Returns a message when the PIN is malformed or too easy to guess; null when it is acceptable.
export function pinProblem(pin: unknown): string | null {
  if (!isPinFormat(pin)) return `Enter exactly ${PIN_LENGTH} digits.`;
  if (/^(\d)\1+$/.test(pin)) return 'Avoid repeating one digit. Choose a harder PIN.';
  if (isStraight(pin, 1) || isStraight(pin, -1)) return 'Avoid number sequences like 123456. Choose a harder PIN.';
  if (/^(\d\d)\1\1$/.test(pin) || /^(\d{3})\1$/.test(pin)) return 'Avoid repeating patterns like 121212. Choose a harder PIN.';
  return null;
}
