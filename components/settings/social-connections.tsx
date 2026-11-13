'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Unplug } from 'lucide-react';
import { disconnectSocialAction } from '@/app/social/connection-actions';
import type { SocialConnectionStatus } from '@/lib/social/connections';
import { BrandMark } from '@/components/settings/brand-mark';
import { safeAction } from '@/lib/client/safe-action';

const PLATFORMS = [
  {
    id: 'instagram', name: 'Instagram', detail: 'Publish planned posts, read-only otherwise', href: '/auth/social/instagram/start', handle: '@',
    notConfigured: 'Set INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET.',
    expired: 'The token has expired. Meta tokens last about 60 days and cannot be renewed once they lapse.',
  },
  {
    id: 'threads', name: 'Threads', detail: 'Publish planned posts, read-only otherwise', href: '/auth/social/threads/start', handle: '@',
    notConfigured: 'Set THREADS_APP_ID and THREADS_APP_SECRET.',
    expired: 'The token has expired. Meta tokens last about 60 days and cannot be renewed once they lapse.',
  },
  {
    id: 'youtube', name: 'YouTube', detail: 'Upload your shorts on a schedule', href: '/auth/youtube/start', handle: '',
    notConfigured: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
    expired: 'Google stopped accepting Orbis’s access. Connect again.',
  },
] as const;

/** The status pill: connected, waiting on a reconnect, or not connected at all. */
function connectionStatus(linked: boolean, expired: boolean) {
  if (!linked) return { tone: 'off', label: 'Not connected' };
  return expired ? { tone: 'warn', label: 'Reconnect' } : { tone: 'on', label: 'Connected' };
}

function connectLabel(name: string, linked: boolean, expired: boolean) {
  if (expired) return `Reconnect ${name}`;
  if (linked) return `Refresh ${name}`;
  return `Connect ${name}`;
}

/**
 * Instagram, Threads and YouTube in Connections.
 *
 * Both were already planning targets: a post could be drafted for them and
 * marked published by hand. What was missing was the account itself, so nothing
 * could actually be posted and the Social tab could only ever record what you
 * had done elsewhere.
 */
export function SocialConnections({ connections, ready, configured }: Readonly<{ connections: SocialConnectionStatus[]; ready: boolean; configured: Record<string, boolean> }>) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function disconnect(platform: string, name: string) {
    if (!window.confirm(`Disconnect ${name}? Posts you already published stay as they are.`)) return;
    startTransition(async () => {
      await safeAction(disconnectSocialAction)(platform);
      router.refresh();
    });
  }

  return (
    <>
      {PLATFORMS.map((platform) => {
        const linked = connections.find((item) => item.platform === platform.id) ?? null;
        const expired = linked?.status === 'reconnect_required';
        const isConfigured = configured[platform.id];
        const status = connectionStatus(Boolean(linked), expired);
        return (
          <article className="pf-app" key={platform.id}>
            <div className="pf-app-head">
              <span className="pf-app-tile fd-tile pf-tile" aria-hidden="true"><BrandMark id={platform.id} /></span>
              <span className="fd-two">
                {platform.name}
                <small>{linked?.username ? `${platform.handle}${linked.username}` : platform.detail}</small>
              </span>
              <span className={`app-status pf-status ${status.tone}`}>
                <i aria-hidden="true" />{status.label}
              </span>
            </div>

            {!ready && <p className="fd-note tight">Apply the social connections migration in Supabase to link these.</p>}
            {ready && !isConfigured && (
              <p className="fd-note tight">
                Not configured on this server. {platform.notConfigured}
              </p>
            )}
            {expired && <p className="fd-note tight">{platform.expired}</p>}

            <div className="fd-act pf-act">
              {ready && isConfigured && (
                <a className="fd-button" href={platform.href}>
                  {connectLabel(platform.name, Boolean(linked), expired)}
                </a>
              )}
              {linked && (
                <button className="fd-link alert" type="button" disabled={isPending} onClick={() => disconnect(platform.id, platform.name)}>
                  <Unplug size={13} aria-hidden="true" /> Disconnect
                </button>
              )}
            </div>
          </article>
        );
      })}
    </>
  );
}
