import 'server-only';

import type { NotificationContext } from '@/lib/notifications/context';
import { writeBrief } from '@/lib/brief/compose';

export type ComposedNotification = { title: string; body: string; source: 'ai' | 'rules' } | { skip: true };

const TITLE_MAX = 60;
const BODY_MAX = 180;

function clip(text: string, max: number) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20))}…`;
}

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

const GREETING: Record<NotificationContext['slot'], string> = {
  morning: 'Good morning',
  lunch: 'Lunch check-in',
  evening: 'Your evening',
  night: 'Winding down',
};

/**
 * Orbis's own wording, used when no provider may hold the data.
 *
 * It says the same things in the same voice as the home note: what is due, then
 * what is waiting. It used to talk about habits, a feature the app no longer
 * has, which meant the fallback described a day that could not exist.
 */
export function ruleNotification(context: NotificationContext): { title: string; body: string; source: 'rules' } {
  const hello = context.name ? `, ${context.name}` : '';
  const open = context.routines.filter((routine) => routine.status === null);
  const spendLine = context.spending ? `Spent ${money(context.spending.today, context.spending.currency)} today, ${money(context.spending.month, context.spending.currency)} this month.` : '';
  const others = open.length > 1 ? ` ${open.length - 1} other${open.length > 2 ? 's' : ''} still open today.` : '';
  // The same four states as the home note, and the same rule: Orbis has not
  // heard about a routine, it never says one was missed.
  const current = context.routine;
  const routineLine = current
    ? current.state === 'now' ? `It’s time for ${current.title}.${others}`
      : current.state === 'unheard' ? `${current.title} was ${current.flexible ? 'usually around' : 'set for'} ${current.at}; I haven’t heard how it went.${others}`
        : `${current.title} is ${current.flexible ? 'around' : 'at'} ${current.at}.${others}`
    : context.routines.length
      ? 'Everything on today’s list is answered.'
      : '';
  const parts: Record<NotificationContext['slot'], string[]> = {
    morning: [routineLine, context.socialLine, 'A good start sets up the day.'],
    lunch: [routineLine, 'Eat well and drink some water.', spendLine],
    evening: [routineLine, spendLine],
    night: [routineLine, 'Aim for a good night’s sleep.'],
  };
  return {
    title: clip(`${GREETING[context.slot]}${hello}`, TITLE_MAX),
    body: clip(parts[context.slot].filter(Boolean).join(' ') || 'A quick check-in from Orbis.', BODY_MAX),
    source: 'rules',
  };
}

/**
 * Writes the notification through the shared brief writer, so the push and the
 * app agree about the day, and falls back to Orbis's own wording on any failure.
 */
export async function composeNotification(userId: string, context: NotificationContext): Promise<ComposedNotification> {
  // What the model sees mirrors the home brief's snapshot: one placed routine,
  // not the day's list, so the prompt's rules about `routine` apply as written.
  const written = await writeBrief(userId, { ...context, routines: undefined }, 'push');
  if (!written) return ruleNotification(context);
  return {
    title: clip(written.title ?? `${GREETING[context.slot]}${context.name ? `, ${context.name}` : ''}`, TITLE_MAX),
    body: clip(written.caption, BODY_MAX),
    source: 'ai',
  };
}
