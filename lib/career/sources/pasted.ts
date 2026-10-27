/**
 * Career: which ATS a pasted job link belongs to. Pure and client-safe, so the
 * "Paste a job" form can tell, as the owner types, whether Orbis will read the
 * listing itself or needs the title and company too (app/career/actions.ts
 * pasteJobAction asks the same question of the same function).
 */

export type PastedRef =
  | { kind: 'greenhouse'; token: string; id: string }
  | { kind: 'lever'; site: string; id: string; eu: boolean }
  | { kind: 'ashby'; board: string; id: string }
  | { kind: 'recruitee'; company: string; slug: string };

/** The name each ATS goes by on screen. */
export const PASTED_ATS_LABEL: Record<PastedRef['kind'], string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  recruitee: 'Recruitee',
};

const GREENHOUSE_HOSTS = new Set(['boards.greenhouse.io', 'job-boards.greenhouse.io']);
const LEVER_HOSTS = new Set(['jobs.lever.co', 'jobs.eu.lever.co']);

function parseUrl(text: string) {
  try {
    const url = new URL(text.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

// A board token goes into the Greenhouse API path, so it must look like one: never '.', '..' or a slash.
const GREENHOUSE_TOKEN = /^[A-Za-z0-9_-]+$/;

function greenhouseRef(url: URL, parts: string[]): PastedRef | null {
  // The embedded form: /embed/job_app?for=<token>&token=<id>.
  if (parts[0] === 'embed') {
    const token = url.searchParams.get('for');
    const id = url.searchParams.get('token');
    return token && GREENHOUSE_TOKEN.test(token) && id && /^\d+$/.test(id) ? { kind: 'greenhouse', token, id } : null;
  }
  const [token, jobs, id] = parts;
  return token && jobs === 'jobs' && id && /^\d+$/.test(id) ? { kind: 'greenhouse', token, id } : null;
}

function recruiteeRef(host: string, parts: string[]): PastedRef | null {
  const company = host.slice(0, -'.recruitee.com'.length);
  const offer = parts.indexOf('o');
  const slug = offer === -1 ? '' : parts[offer + 1];
  return company && !company.includes('.') && slug ? { kind: 'recruitee', company, slug } : null;
}

/** Which ATS a pasted job link belongs to, with what's needed to read it from that ATS's API. Null for anything else. */
export function pastedUrlKind(text: string): PastedRef | null {
  const url = parseUrl(text);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  if (GREENHOUSE_HOSTS.has(host)) return greenhouseRef(url, parts);
  if (LEVER_HOSTS.has(host) && parts.length >= 2) return { kind: 'lever', site: parts[0], id: parts[1], eu: host === 'jobs.eu.lever.co' };
  if (host === 'jobs.ashbyhq.com' && parts.length >= 2) return { kind: 'ashby', board: parts[0], id: parts[1] };
  if (host.endsWith('.recruitee.com')) return recruiteeRef(host, parts);
  return null;
}
