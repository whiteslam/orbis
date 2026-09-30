import type { ContainerSpec, MetaPlatform } from '@/lib/meta/types';

// Every Meta call as data: URL, method and form body. Pure, so the exact
// requests are tested without a network. Verified against Meta's docs on
// 2026-09-30 (see the spec's "Meta API mapping").

export type MetaRequest = { url: string; method: 'GET' | 'POST'; body?: URLSearchParams };

const GRAPH: Record<MetaPlatform, string> = { instagram: 'https://graph.instagram.com', threads: 'https://graph.threads.com' };
const VERSION: Record<MetaPlatform, string> = { instagram: 'v25.0', threads: 'v1.0' };
const AUTHORIZE: Record<MetaPlatform, string> = { instagram: 'https://www.instagram.com/oauth/authorize', threads: 'https://threads.com/oauth/authorize' };
const CODE_EXCHANGE: Record<MetaPlatform, string> = { instagram: 'https://api.instagram.com/oauth/access_token', threads: 'https://graph.threads.com/oauth/access_token' };
export const SCOPES: Record<MetaPlatform, string> = {
  instagram: 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights',
  threads: 'threads_basic,threads_content_publish,threads_manage_insights',
};
const GRANT: Record<MetaPlatform, { exchange: string; refresh: string }> = {
  instagram: { exchange: 'ig_exchange_token', refresh: 'ig_refresh_token' },
  threads: { exchange: 'th_exchange_token', refresh: 'th_refresh_token' },
};

const api = (platform: MetaPlatform, path: string, query: Record<string, string> = {}) => {
  const url = new URL(`${GRAPH[platform]}/${VERSION[platform]}/${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
};
const get = (url: string): MetaRequest => ({ url, method: 'GET' });
const post = (url: string, form: Record<string, string>): MetaRequest => ({ url, method: 'POST', body: new URLSearchParams(form) });

export function authorizeUrl(platform: MetaPlatform, { clientId, redirectUri, state }: { clientId: string; redirectUri: string; state: string }) {
  const url = new URL(AUTHORIZE[platform]);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES[platform]);
  url.searchParams.set('state', state);
  return url.toString();
}

export function codeExchange(platform: MetaPlatform, input: { clientId: string; clientSecret: string; redirectUri: string; code: string }) {
  return post(CODE_EXCHANGE[platform], {
    client_id: input.clientId, client_secret: input.clientSecret, grant_type: 'authorization_code', redirect_uri: input.redirectUri, code: input.code,
  });
}

export function longLivedExchange(platform: MetaPlatform, { clientSecret, token }: { clientSecret: string; token: string }) {
  const url = new URL(`${GRAPH[platform]}/access_token`);
  url.searchParams.set('grant_type', GRANT[platform].exchange);
  url.searchParams.set('client_secret', clientSecret);
  url.searchParams.set('access_token', token);
  return get(url.toString());
}

export function refreshToken(platform: MetaPlatform, token: string) {
  const url = new URL(`${GRAPH[platform]}/refresh_access_token`);
  url.searchParams.set('grant_type', GRANT[platform].refresh);
  url.searchParams.set('access_token', token);
  return get(url.toString());
}

export function me(platform: MetaPlatform, token: string) {
  return get(api(platform, 'me', { fields: platform === 'instagram' ? 'user_id,username' : 'id,username', access_token: token }));
}

export function monthMedia(platform: MetaPlatform, accountId: string, token: string, range: { since: number; until: number }) {
  const fields = platform === 'instagram'
    ? 'id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url'
    : 'id,text,media_type,permalink,timestamp';
  return get(api(platform, `${accountId}/${platform === 'instagram' ? 'media' : 'threads'}`, {
    fields, since: String(range.since), until: String(range.until), limit: '50', access_token: token,
  }));
}

// Asking Instagram for a metric a media type lacks fails the whole call.
const IG_METRICS: Record<string, string> = { STORY: 'reach,views,shares,replies' };
const IG_DEFAULT_METRICS = 'reach,views,likes,comments,saved,shares';

export function mediaInsights(platform: MetaPlatform, mediaId: string, token: string, productType?: string | null) {
  const metric = platform === 'instagram' ? IG_METRICS[productType ?? ''] ?? IG_DEFAULT_METRICS : 'views,likes,replies,reposts,quotes,shares';
  return get(api(platform, `${mediaId}/insights`, { metric, access_token: token }));
}

export function createContainer(platform: MetaPlatform, accountId: string, token: string, spec: ContainerSpec) {
  const path = `${accountId}/${platform === 'instagram' ? 'media' : 'threads'}`;
  if (platform === 'instagram') {
    const form: Record<string, string> =
      spec.kind === 'image' ? { image_url: spec.mediaUrl, caption: spec.text }
        : spec.kind === 'video' ? { media_type: 'REELS', video_url: spec.mediaUrl, caption: spec.text, share_to_feed: 'true' }
          : spec.kind === 'story_image' ? { media_type: 'STORIES', image_url: spec.mediaUrl }
            : spec.kind === 'story_video' ? { media_type: 'STORIES', video_url: spec.mediaUrl }
              : (() => { throw new Error('Instagram needs a photo or video.'); })();
    return post(api(platform, path), { ...form, access_token: token });
  }
  const form: Record<string, string> =
    spec.kind === 'text' ? { media_type: 'TEXT', text: spec.text }
      : spec.kind === 'image' ? { media_type: 'IMAGE', image_url: spec.mediaUrl, text: spec.text }
        : spec.kind === 'video' ? { media_type: 'VIDEO', video_url: spec.mediaUrl, text: spec.text }
          : (() => { throw new Error('Threads has no Stories.'); })();
  return post(api(platform, path), { ...form, access_token: token });
}

export function containerStatus(platform: MetaPlatform, containerId: string, token: string) {
  return get(api(platform, containerId, { fields: platform === 'instagram' ? 'status_code' : 'status,error_message', access_token: token }));
}

export function publishContainer(platform: MetaPlatform, accountId: string, token: string, containerId: string) {
  return post(api(platform, `${accountId}/${platform === 'instagram' ? 'media_publish' : 'threads_publish'}`), { creation_id: containerId, access_token: token });
}

export function mediaDetails(platform: MetaPlatform, mediaId: string, token: string) {
  return get(api(platform, mediaId, { fields: 'permalink,timestamp', access_token: token }));
}
