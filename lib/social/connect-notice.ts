// What /auth/social/[platform]/start and /callback report back through
// ?social=<platform>-<outcome> (and ?why= for Meta's own reason on failure).
//
// Nothing used to read it, so every outcome, success or failure, looked like
// the Connect button doing nothing. Pure, so the wording is unit-tested; the
// text comes from here, never from the URL, except the failure reason, which is
// shown as plain text and cut short because anyone can put text in a link.

export type SocialConnectNotice = { tone: 'success' | 'error' | 'info'; text: string; platform: 'instagram' | 'threads' | 'youtube' };

const NAMES = { instagram: 'Instagram', threads: 'Threads', youtube: 'YouTube' } as const;
const KEYS = { instagram: 'INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET', threads: 'THREADS_APP_ID and THREADS_APP_SECRET', youtube: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET' } as const;
const WHY_MAX = 160;

export function socialConnectNotice(code: string | null, why: string | null): SocialConnectNotice | null {
  if (!code) return null;
  const platform = /^(instagram|threads|youtube)-/.exec(code)?.[1] as SocialConnectNotice['platform'] | undefined;
  const notice = platform ? noticeText(code, why) : null;
  return notice && platform ? { ...notice, platform } : null;
}

function noticeText(code: string, why: string | null): Omit<SocialConnectNotice, 'platform'> | null {
  const match = /^(instagram|threads|youtube)-(connected|cancelled|failed|not-configured|needs-https|no-channel)$/.exec(code);
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
      if (platform === 'youtube') return { tone: 'error', text: 'Google needs an HTTPS address to connect YouTube. Connect it from the live site, or open this computer through an HTTPS tunnel.' };
      return { tone: 'error', text: `${name} can only be connected from an HTTPS address, because Meta refuses anything else. Connect it from the live site, or open this computer through an HTTPS tunnel.` };
    case 'no-channel':
      // Only YouTube sends this one; the other two are never given a channel to lack.
      if (platform !== 'youtube') return null;
      return { tone: 'error', text: 'That Google account has no YouTube channel. If your channel is a brand account, connect again and pick the channel’s account on Google’s screen; otherwise create one at youtube.com.' };
    default: {
      const reason = why?.replace(/\s+/g, ' ').trim().slice(0, WHY_MAX);
      // Meta's reason is quoted; YouTube's is Orbis's own sentence, so it stands alone.
      const next = reason ? (platform === 'youtube' ? reason : `Meta said: ${reason}`) : 'Try again.';
      return { tone: 'error', text: `${name} could not be connected. ${next}` };
    }
  }
}
