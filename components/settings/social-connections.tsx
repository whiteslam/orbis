'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Unplug } from 'lucide-react';
import { disconnectSocialAction } from '@/app/social/connection-actions';
import type { SocialConnectionStatus } from '@/lib/social/connections';
import { BrandMark } from '@/components/settings/brand-mark';
import { safeAction } from '@/lib/client/safe-action';

const PLATFORMS = [
  { id: 'instagram', name: 'Instagram', detail: 'Publish planned posts, read-only otherwise' },
  { id: 'threads', name: 'Threads', detail: 'Publish planned posts, read-only otherwise' },
] as const;

/**
 * Instagram and Threads in Connections.
 *
 * Both were already planning targets: a post could be drafted for them and
 * marked published by hand. What was missing was the account itself, so nothing
 * could actually be posted and the Social tab could only ever record what you
 * had done elsewhere.
 */
export function SocialConnections({ connections, ready, configured }: { connections: SocialConnectionStatus[]; ready: boolean; configured: Record<string, boolean> }) {
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
        return (
          <article className="pf-app" key={platform.id}>
            <div className="pf-app-head">
              <span className="pf-app-tile"><BrandMark id={platform.id} /></span>
              <span className="fd-two">
                {platform.name}
                <small>{linked?.username ? `@${linked.username}` : platform.detail}</small>
              </span>
              <span className={`app-status ${linked ? (expired ? 'warn' : 'on') : 'off'}`}>
                <i aria-hidden="true" />{linked ? (expired ? 'Reconnect' : 'Connected') : 'Not connected'}
              </span>
            </div>

            {!ready && <p className="fd-note tight">Apply the social connections migration in Supabase to link these.</p>}
            {ready && !isConfigured && (
              <p className="fd-note tight">
                Not configured on this server. {platform.id === 'instagram' ? 'Set META_APP_ID and META_APP_SECRET.' : 'Set THREADS_APP_ID and THREADS_APP_SECRET.'}
              </p>
            )}
            {expired && <p className="fd-note tight">The token has expired. Meta tokens last about 60 days and cannot be renewed once they lapse.</p>}

            <div className="fd-act pf-act">
              {ready && isConfigured && (
                <a className="fd-button" href={`/auth/social/${platform.id}/start`}>
                  {expired ? `Reconnect ${platform.name}` : linked ? `Refresh ${platform.name}` : `Connect ${platform.name}`}
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
