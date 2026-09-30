// Local calendar dates as 'YYYY-MM-DD' strings. Arithmetic is done at UTC noon,
// so no timezone or daylight-saving shift can move a date by a day.

const noon = (date: string) => new Date(`${date}T12:00:00Z`);
const iso = (value: Date) => value.toISOString().slice(0, 10);

export function addDays(date: string, days: number) {
  const value = noon(date);
  value.setUTCDate(value.getUTCDate() + days);
  return iso(value);
}

export function daysBetween(from: string, to: string) {
  return Math.round((noon(to).getTime() - noon(from).getTime()) / 86_400_000);
}

/** 0 = Sunday, as routines store it. */
export function weekday(date: string) {
  return noon(date).getUTCDay();
}

export function monthOf(date: string) {
  return date.slice(0, 7);
}

export function dayOfMonth(date: string) {
  return Number(date.slice(8, 10));
}

export function mondayOf(date: string) {
  return addDays(date, -((weekday(date) + 6) % 7));
}
