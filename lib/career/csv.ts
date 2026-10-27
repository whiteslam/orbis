/**
 * The tracker as CSV, for "Export the tracker". Pure.
 *
 * Every cell is quoted, and a cell a spreadsheet would read as a formula
 * (starting with = + - @, or a tab or carriage return) gets a leading
 * apostrophe: job titles and company names come from the open web, and a
 * listing named "=HYPERLINK(…)" must stay text when the owner opens the file.
 */
import type { CareerApplication, CareerJob } from './types.ts';

const FORMULA_START = /^[=+\-@\t\r]/;

/** One cell, quoted and safe to open in a spreadsheet. */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '""';
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/** Rows to CSV text: CRLF line ends, as RFC 4180 and Excel expect. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null | undefined>>): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export type TrackerRow = {
  application: Pick<CareerApplication, 'status' | 'route' | 'sentAt' | 'followUpDue' | 'lastEventAt' | 'prediction' | 'notes' | 'updatedAt'>;
  job: Pick<CareerJob, 'title' | 'company' | 'location' | 'remote' | 'score' | 'source' | 'url' | 'applyUrl'>;
  /** The latest event's summary, if any. */
  latest?: string | null;
};

export const TRACKER_HEADER = [
  'Company', 'Role', 'Status', 'Route', 'Match score', 'Sent', 'Latest', 'Last activity', 'Follow-up due',
  'Reply chance', 'Location', 'Source', 'Listing', 'Apply page', 'Notes',
] as const;

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

function replyChance(prediction: TrackerRow['application']['prediction']): string {
  if (!prediction) return '';
  const [low, high] = prediction.replyRange;
  const range = `${Math.round(low * 100)}–${Math.round(high * 100)}%`;
  return prediction.early ? `${range} (early estimate)` : range;
}

function place(job: TrackerRow['job']): string {
  if (job.remote) return job.location ? `Remote · ${job.location}` : 'Remote';
  return job.location ?? '';
}

/** The tracker, newest activity first, with a header row. */
export function trackerCsv(rows: readonly TrackerRow[]): string {
  const sorted = [...rows].sort((a, b) =>
    (b.application.lastEventAt ?? b.application.updatedAt).localeCompare(a.application.lastEventAt ?? a.application.updatedAt));
  const body = sorted.map(({ application, job, latest }) => [
    job.company,
    job.title,
    application.status,
    application.route,
    job.score,
    day(application.sentAt),
    latest ?? '',
    day(application.lastEventAt ?? application.updatedAt),
    day(application.followUpDue),
    replyChance(application.prediction),
    place(job),
    job.source,
    job.url,
    job.applyUrl ?? '',
    application.notes ?? '',
  ]);
  return toCsv([[...TRACKER_HEADER], ...body]);
}
