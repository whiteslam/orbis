// What /auth/social/[platform]/start and /callback report back through
// ?social=<platform>-<outcome> (and ?why= for Meta's own reason on failure).
//
// Nothing used to read it, so every outcome, success or failure, looked like
// the Connect button doing nothing. Pure, so the wording is unit-tested; the
// text comes from here, never from the URL, except Meta's reason, which is
// shown as plain text and cut short because anyone can put text in a link.

export type SocialConnectNotice = { tone: 'success' | 'error' | 'info'; text: string };

const NAMES = { instagram: 'Instagram', threads: 'Threads' } as const;
const KEYS = { instagram: 'INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET', threads: 'THREADS_APP_ID and THREADS_APP_SECRET' } as const;
const WHY_MAX = 160;

export function socialConnectNotice(code: string | null, why: string | null): SocialConnectNotice | null {
  const match = code?.match(/^(instagram|threads)-(connected|cancelled|failed|not-configured|needs-https)$/);
  if (!match) return null;
  const platform = match[1] as keyof typeof NAMES;
  const name = NAMES[platform];
  switch (match[2]) {
    case 'connected':
      return { tone: 'success', text: `${name} connected.` };
    case 'cancelled':
      return { tone: 'info', text: `${name} connection was cancelled.` };
    case 'not-configured':
      return { tone: 'error', text: `${name} can’t be connected on this server yet. Set ${KEYS[platform]} where Orbis is deployed, then redeploy.` };
    case 'needs-https':
      return { tone: 'error', text: `${name} can only be connected from an HTTPS address, because Meta refuses anything else. Connect it from the live site, or open this computer through an HTTPS tunnel.` };
    default: {
      const reason = why?.replace(/\s+/g, ' ').trim().slice(0, WHY_MAX);
      return { tone: 'error', text: `${name} could not be connected. ${reason ? `Meta said: ${reason}` : 'Try again.'}` };
    }
  }
}
