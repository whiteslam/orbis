# Instagram and Threads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the owner's Instagram (Professional) and Threads accounts to the Social planner, so that:

- published posts show live stats;
- planned posts that went live are marked published automatically;
- a ready post can be published from Orbis after an explicit confirm.

**Architecture:**

- **Pure modules** are fully unit-tested:
  - `requests` builds every Meta call;
  - `tokens` parses token responses;
  - `match` pairs live posts with planned ones;
  - `publish-rules` decides what may go out.
- **Thin server modules** do the I/O:
  - `client` runs a request;
  - `connection` stores encrypted tokens;
  - `live` reads stats and records matches;
  - `publish` claims, creates, checks and publishes.
- **Entry points:**
  - OAuth route handlers copy the Zerodha signed-state pattern;
  - a route handler serves the Social tab's live data;
  - server actions publish.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (RLS plus the service-role admin client), vitest with `node:assert/strict`, and Playwright.

- Route handler `params` is a `Promise`; read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`.
- Server actions follow `app/social/actions.ts`.

**Spec:** `docs/superpowers/specs/2026-09-30-instagram-threads-design.md`. Its "Meta API mapping" section was verified against Meta's docs on 2026-09-30 and is binding.

## Global Constraints

- **Platforms:** `MetaPlatform = 'instagram' | 'threads'`.
- **Hosts and versions:** `graph.instagram.com` `v25.0`; `graph.threads.com` `v1.0`. Instagram authorize is `https://www.instagram.com/oauth/authorize`, Threads authorize is `https://threads.com/oauth/authorize`, and the Instagram code exchange is `https://api.instagram.com/oauth/access_token`.
- **Scopes:**
  - Instagram: `instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights`.
  - Threads: `threads_basic,threads_content_publish,threads_manage_insights`.
- **Environment:** `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `THREADS_APP_ID`, `THREADS_APP_SECRET`. They are never logged and never sent to the browser.
- **Tokens:**
  - Encrypted with `encryptCredential` / `decryptCredential` (`lib/crypto/credentials.ts`).
  - `social_connections` has **no** `authenticated` grant.
  - Refresh when fewer than 7 days are left.
- **Codes and IDs:** the auth code has any trailing `#_` stripped. Account IDs come only from `/me`, as strings; `user_id` in token responses is never read.
- **Instagram insights by media type:** `FEED`/`REELS` use `reach,views,likes,comments,saved,shares`; `STORY` uses `reach,views,shares,replies`. **Threads insights:** `views,likes,replies,reposts,quotes,shares`.
- **Formats:**
  - Instagram images are JPEG only.
  - Threads images are JPEG or PNG.
  - Video is MP4 or MOV on both.
  - An Instagram video post or reel is `REELS` with `share_to_feed=true`; an Instagram story is `STORIES`.
  - Threads has no Stories.
  - Threads `TEXT` is allowed without media; Instagram always needs media.
- **Text sent:** caption, a blank line, then `#tag` joined by spaces, capped at 2,200 characters (Instagram) and 500 (Threads). At most 30 hashtags on Instagram.
- **Publish rate limit:** buckets `social_publish_instagram` and `social_publish_threads`, 10 per 86,400 s each.
- **Meta call timeout:** 8 s.
- **Signed media URLs:** 1 hour (the existing `SIGNED_URL_SECONDS`).
- **Publish polling:** every 5 s for up to 5 minutes. A `processing` publication older than 24 h is deleted.
- **Auto-match:**
  - window of ±3 days around `plannedFor`, or anywhere in `period` when the post has no day;
  - 80-character normalised prefix;
  - normalised planned captions under 12 characters never match;
  - only one-to-one pairs are recorded.
- **Server entry points:** `requireUser()` (sign-in plus app lock) and `isUuid` for ids. Actions return `{ success: boolean; message: string }`, and errors meant for the user are typed copy.
- **Tests:** `import { test } from 'vitest'` and `import assert from 'node:assert/strict'`, under `lib/**/*.test.ts`, with relative `.ts` imports. Production code imports with `@/lib/...`.

## Review Focus

1. **A PNG, WebP or GIF picture on an Instagram post.** Publishing is refused before any Meta call, with a JPEG reason, and the button shows the reason. Pinned in Task 4 (`publishProblem` format cases).
2. **A caption whose emoji or hashtags differ between the plan and the live post.** Auto-match still pairs them, and a two-way ambiguity marks nothing. Pinned in Task 3.
3. **Two taps on Publish, or two tabs.** Only one container is ever created. Pinned by the unique claim in Task 7; the pure part (`publishProblem` refuses while `processing`) is tested in Task 4.
4. **A token that Meta revoked.** The connection flips to Reconnect, and stats and publish say so instead of erroring. `classifyMetaError` is tested in Task 2.
5. **Meta returns `user_id` as a huge JSON number.** The account ID is never taken from it. `parseShortToken` is tested in Task 2 so that it ignores `user_id`.

---

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/202609300200_social_meta.sql` | Two tables, RLS, grants, triggers |
| `lib/meta/types.ts` | Shared, client-safe types |
| `lib/meta/requests.ts` (+test) | Pure builders for every Meta call |
| `lib/meta/tokens.ts` (+test) | Pure token-response parsing, code stripping, refresh decision, error classification |
| `lib/meta/match.ts` (+test) | Pure auto-mark matching |
| `lib/meta/publish-rules.ts` (+test) | Pure publish checks, posted text, container spec |
| `lib/meta/config.ts` | Environment lookup, `metaConfigured` |
| `lib/meta/client.ts` | `callMeta(request)` with timeout and typed errors |
| `lib/meta/connection.ts` | Load, save, delete and refresh connections |
| `lib/meta/live.ts` | Month stats plus auto-mark plus finishing stuck publications |
| `lib/meta/publish.ts` | Start and check publishing |
| `app/auth/meta/[platform]/start/route.ts`, `…/callback/route.ts` | OAuth |
| `app/api/social/live/route.ts` | `GET ?period=` |
| `app/social/meta-actions.ts` | `startPublishAction`, `checkPublishAction`, `disconnectMetaAction` |
| `components/social/live-stats.tsx` | Month line, per-post stats line, "posted outside your plan" |
| `components/social/publish-sheet.tsx` | The confirm sheet and processing state |
| Modify: `lib/security/rate-limit-rules.ts` (+test), `lib/account/deletion-plan.ts` (+test), `lib/social/repository.ts`, `app/social/actions.ts`, `lib/providers/status.ts`, `components/settings/app-integrations.tsx`, `components/settings/settings-sheet.tsx`, `components/app-shell.tsx`, `components/social/social-screen.tsx`, `components/social/social-list.tsx`, `components/social/post-drawer.tsx`, `app/privacy/page.tsx`, `lib/site.ts`, `docs/phase-1-owner-actions.md`, `app/styles/atlas-social.css` | |
| `tests/e2e/social/meta.spec.ts` | E2E |

---

### Task 1: Migration, rate-limit buckets, export

**Files:**
- Create: `supabase/migrations/202609300200_social_meta.sql`
- Modify: `lib/security/rate-limit-rules.ts`, `lib/security/rate-limit-rules.test.ts`, `lib/account/deletion-plan.ts`, `lib/account/deletion-plan.test.ts`

**Interfaces:**
- Produces:
  - tables `public.social_connections` and `public.social_publications`;
  - `RateBucket` gains `'social_publish_instagram' | 'social_publish_threads'`;
  - `EXPORT_TABLES` gains `social_publications`.

- [ ] **Step 1: Write the failing tests.** Append to `lib/security/rate-limit-rules.test.ts`:

```ts
test('publishing to Instagram or Threads is capped at ten a day each', () => {
  assert.deepEqual(limitFor('social_publish_instagram'), { limit: 10, windowSeconds: 86_400 });
  assert.deepEqual(limitFor('social_publish_threads'), { limit: 10, windowSeconds: 86_400 });
  assert.match(rateLimitMessage('social_publish_instagram'), /Instagram.*tomorrow/i);
  assert.match(rateLimitMessage('social_publish_threads'), /Threads.*tomorrow/i);
});
```

Append to `lib/account/deletion-plan.test.ts`:

```ts
test('the export includes publications but never the Meta tokens', () => {
  const tables = EXPORT_TABLES.map((entry) => entry.table);
  assert.ok(tables.includes('social_publications'));
  assert.ok(!tables.includes('social_connections'));
});
```

- [ ] **Step 2: Run them.** `npx vitest run lib/security/rate-limit-rules.test.ts lib/account/deletion-plan.test.ts`. Expected: FAIL (TypeScript accepts the unknown bucket at runtime, but `limitFor` returns undefined fields, and the export test fails on `includes`).

- [ ] **Step 3: Implement.** In `lib/security/rate-limit-rules.ts`:

```ts
export type RateBucket = 'uploads' | 'parse' | 'sync' | 'password' | 'social_publish_instagram' | 'social_publish_threads';
```

- Add to `RATE_LIMITS`: `social_publish_instagram: { limit: 10, windowSeconds: 86_400 }, social_publish_threads: { limit: 10, windowSeconds: 86_400 },`.
- Add to `MESSAGES`: `social_publish_instagram: 'You’ve published to Instagram from Orbis as often as it allows in a day. Try again tomorrow.', social_publish_threads: 'You’ve published to Threads from Orbis as often as it allows in a day. Try again tomorrow.',`.

In `lib/account/deletion-plan.ts`, append `'social_publications',` to the `EXPORT_TABLES` list after the last entry.

- [ ] **Step 4: Write the migration** `supabase/migrations/202609300200_social_meta.sql`:

```sql
-- Orbis: Instagram and Threads, connected to the Social planner.
--
-- social_connections holds each platform's access token, encrypted. The browser
-- never reads this table: it has no grant for `authenticated` at all, and the
-- app reads it with the service role. social_publications records where each
-- post went out, one row per post per platform. Safe to run more than once.

create table if not exists public.social_connections (
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('instagram', 'threads')),
  account_id text not null check (char_length(account_id) between 1 and 64),
  username text not null check (char_length(username) between 1 and 64),
  access_token_encrypted text not null,
  expires_at timestamptz not null,
  status text not null default 'connected' check (status in ('connected', 'reconnect_required')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, platform)
);

drop trigger if exists social_connections_set_updated_at on public.social_connections;
create trigger social_connections_set_updated_at
  before update on public.social_connections
  for each row execute function public.set_updated_at();

alter table public.social_connections enable row level security;
revoke all on public.social_connections from public, anon, authenticated;
grant select, insert, update, delete on public.social_connections to service_role;

create table if not exists public.social_publications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  post_id uuid not null references public.social_posts (id) on delete cascade,
  platform text not null check (platform in ('instagram', 'threads')),
  status text not null check (status in ('processing', 'published')),
  source text not null check (source in ('orbis', 'matched')),
  container_id text check (container_id is null or char_length(container_id) between 1 and 64),
  external_id text check (external_id is null or char_length(external_id) between 1 and 64),
  permalink text check (permalink is null or permalink ~* '^https://'),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, platform),
  constraint social_publications_published_complete
    check (status <> 'published' or (external_id is not null and published_at is not null))
);

create index if not exists social_publications_user_idx on public.social_publications (user_id, status);

drop trigger if exists social_publications_set_updated_at on public.social_publications;
create trigger social_publications_set_updated_at
  before update on public.social_publications
  for each row execute function public.set_updated_at();

alter table public.social_publications enable row level security;
revoke all on public.social_publications from public, anon, authenticated;
grant select on public.social_publications to authenticated;
grant select, insert, update, delete on public.social_publications to service_role;

drop policy if exists "Users read their own publications" on public.social_publications;
create policy "Users read their own publications" on public.social_publications
  for select to authenticated
  using ((select auth.uid()) = user_id);
```

- [ ] **Step 5: Run the tests.** `npx vitest run lib/security lib/account` → PASS. Then `npx tsc --noEmit` → exit 0.

- [ ] **Step 6: Commit.**

```bash
git add supabase/migrations/202609300200_social_meta.sql lib/security/rate-limit-rules.ts lib/security/rate-limit-rules.test.ts lib/account/deletion-plan.ts lib/account/deletion-plan.test.ts
git commit -m "Instagram and Threads: tables, publish limits and export"
```

---

### Task 2: Types, request builders and token helpers

**Files:**
- Create: `lib/meta/types.ts`, `lib/meta/requests.ts`, `lib/meta/tokens.ts`
- Test: `lib/meta/requests.test.ts`, `lib/meta/tokens.test.ts`

**Interfaces:**
- Produces (types.ts):

```ts
MetaPlatform
META_PLATFORMS
META_LABEL
ContainerSpec
LiveStats
LivePost
PlatformLive
SocialLive
ConnectionSummary
PublishResult
```

- Produces (requests.ts). Every builder returns `MetaRequest = { url: string; method: 'GET' | 'POST'; body?: URLSearchParams }`:

```ts
authorizeUrl(platform, { clientId, redirectUri, state }): string
codeExchange(platform, { clientId, clientSecret, redirectUri, code })
longLivedExchange(platform, { clientSecret, token })
refreshToken(platform, token)
me(platform, token)
monthMedia(platform, accountId, token, { since, until })
mediaInsights(platform, mediaId, token, productType?: string)
createContainer(platform, accountId, token, spec: ContainerSpec)
containerStatus(platform, containerId, token)
publishContainer(platform, accountId, token, containerId)
mediaDetails(platform, mediaId, token)
```

- Produces (tokens.ts):

```ts
stripCode(code: string): string
parseShortToken(json: unknown): string | null
parseLongToken(json: unknown, now: Date): { accessToken: string; expiresAt: string } | null
parseMe(platform, json): { accountId: string; username: string } | null
needsRefresh(expiresAt: string, now: Date): boolean
classifyMetaError(status: number, json: unknown): { kind: 'auth' | 'rejected' | 'unavailable'; message: string }
```

- [ ] **Step 1: Write `lib/meta/types.ts`:**

```ts
// Instagram and Threads, as the Social planner sees them. Client-safe.

export type MetaPlatform = 'instagram' | 'threads';
export const META_PLATFORMS: MetaPlatform[] = ['instagram', 'threads'];
export const META_LABEL: Record<MetaPlatform, string> = { instagram: 'Instagram', threads: 'Threads' };

/** What one container is made of. `kind` decides the media_type sent. */
export type ContainerSpec =
  | { kind: 'image'; mediaUrl: string; text: string }
  | { kind: 'video'; mediaUrl: string; text: string }
  | { kind: 'story_image'; mediaUrl: string; text: string }
  | { kind: 'story_video'; mediaUrl: string; text: string }
  | { kind: 'text'; text: string };

/** Normalised stats. A number is absent when that platform or media type has no such metric. */
export type LiveStats = { views?: number; reach?: number; likes?: number; comments?: number; saves?: number; shares?: number; reposts?: number; quotes?: number };

export type LivePost = {
  externalId: string;
  caption: string;
  permalink: string | null;
  timestamp: string;
  productType: string | null;
  thumbnail: string | null;
  stats: LiveStats | null;
};

export type PlatformLive = {
  platform: MetaPlatform;
  username: string;
  state: 'ok' | 'reconnect' | 'unavailable';
  posts: LivePost[];
  /** Planned posts newly marked published by this call. */
  matchedPostIds: string[];
  /** External id → Orbis post id, for every publication on this platform this month. */
  publications: Record<string, string>;
};

export type SocialLive = { platforms: PlatformLive[] };

export type ConnectionSummary = {
  platform: MetaPlatform;
  username: string;
  status: 'connected' | 'reconnect_required';
};

export type PublishResult =
  | { success: true; message: string; state: 'published'; permalink: string | null }
  | { success: true; message: string; state: 'processing'; publicationId: string }
  | { success: false; message: string };
```

- [ ] **Step 2: Write the failing test** `lib/meta/requests.test.ts`:

```ts
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { authorizeUrl, codeExchange, containerStatus, createContainer, longLivedExchange, me, mediaInsights, monthMedia, publishContainer, refreshToken } from './requests.ts';

const params = (url: string) => Object.fromEntries(new URL(url).searchParams);

test('authorize URLs carry the scopes, state and redirect', () => {
  const ig = new URL(authorizeUrl('instagram', { clientId: '123', redirectUri: 'https://x.test/auth/meta/instagram/callback', state: 's1' }));
  assert.equal(`${ig.origin}${ig.pathname}`, 'https://www.instagram.com/oauth/authorize');
  assert.deepEqual(params(ig.toString()), {
    client_id: '123', redirect_uri: 'https://x.test/auth/meta/instagram/callback', response_type: 'code', state: 's1',
    scope: 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights',
  });
  const th = new URL(authorizeUrl('threads', { clientId: '9', redirectUri: 'https://x.test/auth/meta/threads/callback', state: 's2' }));
  assert.equal(`${th.origin}${th.pathname}`, 'https://threads.com/oauth/authorize');
  assert.equal(th.searchParams.get('scope'), 'threads_basic,threads_content_publish,threads_manage_insights');
});

test('the code exchange is a form POST to each platform’s token endpoint', () => {
  const ig = codeExchange('instagram', { clientId: '1', clientSecret: 'sec', redirectUri: 'https://x.test/cb', code: 'abc' });
  assert.equal(ig.method, 'POST');
  assert.equal(ig.url, 'https://api.instagram.com/oauth/access_token');
  assert.deepEqual(Object.fromEntries(ig.body!), { client_id: '1', client_secret: 'sec', grant_type: 'authorization_code', redirect_uri: 'https://x.test/cb', code: 'abc' });
  assert.equal(codeExchange('threads', { clientId: '1', clientSecret: 's', redirectUri: 'r', code: 'c' }).url, 'https://graph.threads.com/oauth/access_token');
});

test('long-lived exchange and refresh use each platform’s grant type', () => {
  assert.deepEqual(params(longLivedExchange('instagram', { clientSecret: 'sec', token: 't' }).url), { grant_type: 'ig_exchange_token', client_secret: 'sec', access_token: 't' });
  assert.ok(longLivedExchange('threads', { clientSecret: 's', token: 't' }).url.startsWith('https://graph.threads.com/access_token?'));
  assert.equal(new URL(refreshToken('instagram', 't').url).searchParams.get('grant_type'), 'ig_refresh_token');
  assert.equal(new URL(refreshToken('threads', 't').url).pathname, '/refresh_access_token');
  assert.equal(new URL(refreshToken('threads', 't').url).searchParams.get('grant_type'), 'th_refresh_token');
});

test('me asks Instagram for user_id (the account id) and Threads for id', () => {
  assert.equal(new URL(me('instagram', 't').url).searchParams.get('fields'), 'user_id,username');
  assert.equal(new URL(me('instagram', 't').url).pathname, '/v25.0/me');
  assert.equal(new URL(me('threads', 't').url).searchParams.get('fields'), 'id,username');
  assert.equal(new URL(me('threads', 't').url).host, 'graph.threads.com');
});

test('a month of media is asked for by Unix time', () => {
  const url = new URL(monthMedia('instagram', '178', 't', { since: 1_788_192_000, until: 1_790_784_000 }).url);
  assert.equal(url.pathname, '/v25.0/178/media');
  assert.equal(url.searchParams.get('since'), '1788192000');
  assert.equal(url.searchParams.get('limit'), '50');
  assert.match(url.searchParams.get('fields')!, /media_product_type/);
  assert.equal(new URL(monthMedia('threads', '55', 't', { since: 1, until: 2 }).url).pathname, '/v1.0/55/threads');
});

test('insight metrics depend on the platform and the media type', () => {
  const metric = (url: string) => new URL(url).searchParams.get('metric');
  assert.equal(metric(mediaInsights('instagram', 'm', 't', 'FEED').url), 'reach,views,likes,comments,saved,shares');
  assert.equal(metric(mediaInsights('instagram', 'm', 't', 'REELS').url), 'reach,views,likes,comments,saved,shares');
  assert.equal(metric(mediaInsights('instagram', 'm', 't', 'STORY').url), 'reach,views,shares,replies');
  assert.equal(metric(mediaInsights('threads', 'm', 't').url), 'views,likes,replies,reposts,quotes,shares');
});

test('containers: Instagram image, reel and story; Threads text and image', () => {
  const body = (request: { body?: URLSearchParams }) => Object.fromEntries(request.body!);
  assert.deepEqual(body(createContainer('instagram', '178', 't', { kind: 'image', mediaUrl: 'https://m/a.jpg', text: 'hi' })), { image_url: 'https://m/a.jpg', caption: 'hi', access_token: 't' });
  assert.deepEqual(body(createContainer('instagram', '178', 't', { kind: 'video', mediaUrl: 'https://m/a.mp4', text: 'hi' })), { media_type: 'REELS', video_url: 'https://m/a.mp4', caption: 'hi', share_to_feed: 'true', access_token: 't' });
  assert.deepEqual(body(createContainer('instagram', '178', 't', { kind: 'story_image', mediaUrl: 'https://m/a.jpg', text: 'hi' })), { media_type: 'STORIES', image_url: 'https://m/a.jpg', access_token: 't' });
  assert.equal(createContainer('instagram', '178', 't', { kind: 'image', mediaUrl: 'u', text: '' }).url, 'https://graph.instagram.com/v25.0/178/media');
  assert.deepEqual(body(createContainer('threads', '55', 't', { kind: 'text', text: 'hello' })), { media_type: 'TEXT', text: 'hello', access_token: 't' });
  assert.deepEqual(body(createContainer('threads', '55', 't', { kind: 'image', mediaUrl: 'https://m/a.png', text: 'x' })), { media_type: 'IMAGE', image_url: 'https://m/a.png', text: 'x', access_token: 't' });
  assert.equal(createContainer('threads', '55', 't', { kind: 'text', text: 'x' }).url, 'https://graph.threads.com/v1.0/55/threads');
});

test('status and publish', () => {
  assert.equal(new URL(containerStatus('instagram', 'c1', 't').url).searchParams.get('fields'), 'status_code');
  assert.equal(new URL(containerStatus('threads', 'c1', 't').url).searchParams.get('fields'), 'status,error_message');
  const ig = publishContainer('instagram', '178', 't', 'c1');
  assert.equal(ig.url, 'https://graph.instagram.com/v25.0/178/media_publish');
  assert.deepEqual(Object.fromEntries(ig.body!), { creation_id: 'c1', access_token: 't' });
  assert.equal(publishContainer('threads', '55', 't', 'c1').url, 'https://graph.threads.com/v1.0/55/threads_publish');
});
```

- [ ] **Step 3: Run it.** `npx vitest run lib/meta/requests.test.ts` → FAIL (module not found).

- [ ] **Step 4: Write `lib/meta/requests.ts`:**

```ts
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
```

- [ ] **Step 5: Run it.** `npx vitest run lib/meta/requests.test.ts` → PASS.

- [ ] **Step 6: Write the failing test** `lib/meta/tokens.test.ts`:

```ts
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { classifyMetaError, needsRefresh, parseLongToken, parseMe, parseShortToken, stripCode } from './tokens.ts';

test('the code loses the #_ Meta appends', () => {
  assert.equal(stripCode('AQBx#_'), 'AQBx');
  assert.equal(stripCode('AQBx'), 'AQBx');
});

test('the short token is read flat or wrapped, and user_id is ignored', () => {
  assert.equal(parseShortToken({ access_token: 'a', user_id: 17841405793187218 }), 'a');
  assert.equal(parseShortToken({ data: [{ access_token: 'b', user_id: 1, permissions: 'x' }] }), 'b');
  assert.equal(parseShortToken({ error: { message: 'no' } }), null);
  assert.equal(parseShortToken(null), null);
});

test('the long-lived token gets an expiry from expires_in', () => {
  const now = new Date('2026-09-30T00:00:00Z');
  assert.deepEqual(parseLongToken({ access_token: 'L', token_type: 'bearer', expires_in: 5_184_000 }, now), { accessToken: 'L', expiresAt: '2026-11-29T00:00:00.000Z' });
  assert.equal(parseLongToken({ access_token: 'L' }, now), null, 'no expiry, no token');
});

test('me gives the account id as a string: Instagram user_id, Threads id', () => {
  assert.deepEqual(parseMe('instagram', { id: 'app-scoped', user_id: '17841405793187218', username: 'gaurav' }), { accountId: '17841405793187218', username: 'gaurav' });
  assert.deepEqual(parseMe('threads', { id: '25', username: 'g' }), { accountId: '25', username: 'g' });
  assert.equal(parseMe('instagram', { user_id: 17841405793187218, username: 'g' }), null, 'a number id would already be wrong');
  assert.equal(parseMe('threads', { id: '25' }), null);
});

test('refresh when fewer than seven days are left', () => {
  const now = new Date('2026-09-30T00:00:00Z');
  assert.equal(needsRefresh('2026-10-06T23:59:00Z', now), true);
  assert.equal(needsRefresh('2026-10-07T00:01:00Z', now), false);
});

test('Meta errors: a bad token means reconnect, a 4xx is Meta’s reason, a 5xx is unavailable', () => {
  assert.equal(classifyMetaError(400, { error: { code: 190, message: 'Invalid OAuth access token' } }).kind, 'auth');
  assert.deepEqual(classifyMetaError(400, { error: { code: 9004, message: 'x', error_user_msg: 'The media could not be fetched.' } }), { kind: 'rejected', message: 'The media could not be fetched.' });
  assert.deepEqual(classifyMetaError(400, { error: { code: 100, message: 'Invalid parameter' } }), { kind: 'rejected', message: 'Invalid parameter' });
  assert.equal(classifyMetaError(503, {}).kind, 'unavailable');
  assert.equal(classifyMetaError(400, 'not json').kind, 'rejected');
});
```

- [ ] **Step 7: Run it.** `npx vitest run lib/meta/tokens.test.ts` → FAIL.

- [ ] **Step 8: Write `lib/meta/tokens.ts`:**

```ts
import type { MetaPlatform } from '@/lib/meta/types';

const REFRESH_WITHIN_MS = 7 * 86_400_000;
const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' ? value as Record<string, unknown> : null);
const text = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : null);

/** Meta appends "#_" to the code in the redirect; it is not part of the code. */
export function stripCode(code: string) {
  return code.replace(/#_$/, '');
}

/**
 * The short-lived token from the code exchange. Instagram's docs show it both
 * flat and wrapped in `data: [...]`. `user_id` is deliberately never read: it
 * is a JSON number above 2^53, so JSON.parse has already corrupted it.
 */
export function parseShortToken(json: unknown) {
  const body = record(json);
  if (!body) return null;
  const wrapped = Array.isArray(body.data) ? record(body.data[0]) : null;
  return text((wrapped ?? body).access_token);
}

export function parseLongToken(json: unknown, now: Date) {
  const body = record(json);
  const accessToken = text(body?.access_token);
  const expiresIn = typeof body?.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : null;
  if (!accessToken || !expiresIn) return null;
  return { accessToken, expiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString() };
}

/** The account id, as the string /me returns: Instagram's `user_id`, Threads' `id`. */
export function parseMe(platform: MetaPlatform, json: unknown) {
  const body = record(json);
  const accountId = text(platform === 'instagram' ? body?.user_id : body?.id);
  const username = text(body?.username);
  return accountId && username ? { accountId, username } : null;
}

export function needsRefresh(expiresAt: string, now: Date) {
  return new Date(expiresAt).getTime() - now.getTime() < REFRESH_WITHIN_MS;
}

/** What went wrong, in terms the caller acts on. `message` is Meta's own words for a rejection. */
export function classifyMetaError(status: number, json: unknown): { kind: 'auth' | 'rejected' | 'unavailable'; message: string } {
  const error = record(record(json)?.error);
  if (error?.code === 190 || error?.code === 102 || status === 401) return { kind: 'auth', message: 'The connection needs to be renewed.' };
  if (status >= 500 || status === 429) return { kind: 'unavailable', message: 'Meta isn’t responding right now.' };
  return { kind: 'rejected', message: text(error?.error_user_msg) ?? text(error?.message) ?? 'Meta refused the request.' };
}
```

- [ ] **Step 9: Run the tests.** `npx vitest run lib/meta` → PASS. Then `npx tsc --noEmit` → exit 0.

- [ ] **Step 10: Commit.**

```bash
git add lib/meta/types.ts lib/meta/requests.ts lib/meta/requests.test.ts lib/meta/tokens.ts lib/meta/tokens.test.ts
git commit -m "Instagram and Threads: request builders and token helpers"
```

---

### Task 3: Auto-mark matching

**Files:**
- Create: `lib/meta/match.ts`
- Test: `lib/meta/match.test.ts`

**Interfaces:**
- Consumes: `MetaPlatform`, `LivePost` (types.ts).
- Produces:

```ts
normalizeCaption(value: string): string
type PlannedPost = { id: string; platforms: string[]; status: string; plannedFor: string | null; period: string; caption: string; publishedOn: MetaPlatform[] }
matchPosts(platform: MetaPlatform, planned: PlannedPost[], live: LivePost[]): Array<{ postId: string; live: LivePost }>
```

- [ ] **Step 1: Write the failing test** `lib/meta/match.test.ts`:

```ts
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { matchPosts, normalizeCaption, type PlannedPost } from './match.ts';
import type { LivePost } from './types.ts';

const CAPTION = 'Three things I learned building a personal finance app this summer, and why the boring parts mattered most.';
const planned = (extra: Partial<PlannedPost> = {}): PlannedPost => ({
  id: 'p1', platforms: ['instagram'], status: 'ready', plannedFor: '2026-09-20', period: '2026-09-01', caption: CAPTION, publishedOn: [], ...extra,
});
// 10:00 IST on the 21st.
const live = (extra: Partial<LivePost> = {}): LivePost => ({
  externalId: 'm1', caption: `${CAPTION} 🚀\n\n#buildinpublic #fintech`, permalink: 'https://www.instagram.com/p/x/', timestamp: '2026-09-21T04:30:00+0000', productType: 'FEED', thumbnail: null, stats: null, ...extra,
});

test('captions are compared without case, hashtags, emoji, links or extra spaces', () => {
  assert.equal(normalizeCaption('  Hello   WORLD 🚀 #tag https://x.y/z  '), 'hello world');
});

test('a live post that starts with the planned caption matches, emoji and hashtags aside', () => {
  const pairs = matchPosts('instagram', [planned()], [live()]);
  assert.deepEqual(pairs.map((pair) => [pair.postId, pair.live.externalId]), [['p1', 'm1']]);
});

test('only the first 80 characters need to agree, so a caption edited near the end still matches', () => {
  assert.equal(matchPosts('instagram', [planned()], [live({ caption: `${CAPTION.slice(0, 85)} — edited ending` })]).length, 1);
});

test('outside three days of the planned day, no match', () => {
  assert.equal(matchPosts('instagram', [planned()], [live({ timestamp: '2026-09-24T04:30:00+0000' })]).length, 0, '4 days after');
  assert.equal(matchPosts('instagram', [planned()], [live({ timestamp: '2026-09-23T04:30:00+0000' })]).length, 1, '3 days after');
});

test('a post with no day matches anywhere in its month', () => {
  assert.equal(matchPosts('instagram', [planned({ plannedFor: null })], [live({ timestamp: '2026-09-02T04:30:00+0000' })]).length, 1);
  assert.equal(matchPosts('instagram', [planned({ plannedFor: null })], [live({ timestamp: '2026-10-01T04:30:00+0000' })]).length, 0);
});

test('short captions are too weak to match', () => {
  // 'hi everyone' is 11 characters once normalised: under the 12 needed.
  assert.equal(matchPosts('instagram', [planned({ caption: 'Hi everyone' })], [live({ caption: 'Hi everyone' })]).length, 0);
});

test('ambiguity in either direction marks nothing', () => {
  assert.equal(matchPosts('instagram', [planned(), planned({ id: 'p2' })], [live()]).length, 0, 'one live post, two planned');
  assert.equal(matchPosts('instagram', [planned()], [live(), live({ externalId: 'm2' })]).length, 0, 'one planned, two live');
});

test('only candidates for this platform that are not yet published there', () => {
  assert.equal(matchPosts('threads', [planned()], [live()]).length, 0, 'does not list threads');
  assert.equal(matchPosts('instagram', [planned({ publishedOn: ['instagram'] })], [live()]).length, 0);
  assert.equal(matchPosts('instagram', [planned({ status: 'draft' })], [live()]).length, 0);
  assert.equal(matchPosts('instagram', [planned({ status: 'published', publishedOn: ['threads'] })], [live()]).length, 1);
});
```

- [ ] **Step 2: Run it.** `npx vitest run lib/meta/match.test.ts` → FAIL.

- [ ] **Step 3: Write `lib/meta/match.ts`:**

```ts
import type { LivePost, MetaPlatform } from '@/lib/meta/types';

const PREFIX = 80;
const MIN_CAPTION = 12;
const WINDOW_DAYS = 3;

export type PlannedPost = { id: string; platforms: string[]; status: string; plannedFor: string | null; period: string; caption: string; publishedOn: MetaPlatform[] };

/** Lowercase, and without hashtags, emoji, links or runs of whitespace. */
export function normalizeCaption(value: string) {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/\p{Extended_Pictographic}|‍|️/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The India-time date of a Meta timestamp ('2026-09-21T04:30:00+0000'). */
function indiaDate(timestamp: string) {
  const iso = timestamp.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso));
}

function daysApart(a: string, b: string) {
  return Math.abs(Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000));
}

function fits(plan: PlannedPost, post: LivePost) {
  const want = normalizeCaption(plan.caption);
  if (want.length < MIN_CAPTION) return false;
  const day = indiaDate(post.timestamp);
  const inWindow = plan.plannedFor ? daysApart(day, plan.plannedFor) <= WINDOW_DAYS : day.slice(0, 7) === plan.period.slice(0, 7);
  if (!inWindow) return false;
  const got = normalizeCaption(post.caption);
  return want.length < PREFIX ? got === want || got.startsWith(want) : got.startsWith(want.slice(0, PREFIX));
}

/**
 * Pairs live posts with planned ones. Only one-to-one pairs count: a live
 * post that fits two planned posts, or a planned post that fits two live ones,
 * is left for the person to mark, because guessing wrong would be worse.
 */
export function matchPosts(platform: MetaPlatform, planned: PlannedPost[], live: LivePost[]) {
  const candidates = planned.filter((plan) => plan.platforms.includes(platform) && (plan.status === 'ready' || plan.status === 'published') && !plan.publishedOn.includes(platform));
  const pairs: Array<{ postId: string; live: LivePost }> = [];
  for (const plan of candidates) {
    const fitting = live.filter((post) => fits(plan, post));
    if (fitting.length !== 1) continue;
    const rivals = candidates.filter((other) => fits(other, fitting[0]));
    if (rivals.length !== 1) continue;
    pairs.push({ postId: plan.id, live: fitting[0] });
  }
  return pairs;
}
```

- [ ] **Step 4: Run it.** `npx vitest run lib/meta/match.test.ts` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/meta/match.ts lib/meta/match.test.ts
git commit -m "Instagram and Threads: match live posts to planned ones"
```

---

### Task 4: Publish rules

**Files:**
- Create: `lib/meta/publish-rules.ts`
- Test: `lib/meta/publish-rules.test.ts`

**Interfaces:**
- Consumes: `SocialPost` (`lib/social/types`), `postedLength` (`lib/social/month`), `MetaPlatform`, `ContainerSpec`.
- Produces:

```ts
type PublishablePost = Pick<SocialPost, 'status' | 'platforms' | 'format' | 'caption' | 'hashtags' | 'mediaPath' | 'mediaType'>
type PublishContext = { connection: 'connected' | 'reconnect_required' | null; publication: 'processing' | 'published' | null; dirty: boolean }
publishProblem(post, platform, context): string | null
postedText(caption: string, hashtags: string[]): string
containerSpec(post: PublishablePost, platform: MetaPlatform, mediaUrl: string | null): ContainerSpec
```

- [ ] **Step 1: Write the failing test** `lib/meta/publish-rules.test.ts`:

```ts
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { containerSpec, postedText, publishProblem, type PublishablePost } from './publish-rules.ts';

const post = (extra: Partial<PublishablePost> = {}): PublishablePost => ({
  status: 'ready', platforms: ['instagram', 'threads'], format: 'post', caption: 'Hello there', hashtags: ['one', 'two'],
  mediaPath: 'u/p/photo.jpg', mediaType: 'image', ...extra,
});
const ok = { connection: 'connected' as const, publication: null, dirty: false };

test('a ready JPEG post may go to Instagram and Threads', () => {
  assert.equal(publishProblem(post(), 'instagram', ok), null);
  assert.equal(publishProblem(post(), 'threads', ok), null);
});

test('connection comes first', () => {
  assert.equal(publishProblem(post(), 'instagram', { ...ok, connection: null }), 'Connect Instagram in Settings first.');
  assert.equal(publishProblem(post(), 'threads', { ...ok, connection: 'reconnect_required' }), 'Reconnect Threads in Settings.');
});

test('it must be saved and ready (or already out on the other platform)', () => {
  assert.equal(publishProblem(post(), 'instagram', { ...ok, dirty: true }), 'Save the post and mark it ready first.');
  assert.equal(publishProblem(post({ status: 'draft' }), 'instagram', ok), 'Save the post and mark it ready first.');
  assert.equal(publishProblem(post({ status: 'published' }), 'threads', ok), null);
});

test('the platform must be one of the post’s', () => {
  assert.equal(publishProblem(post({ platforms: ['threads'] }), 'instagram', ok), 'Add Instagram to this post’s platforms first.');
});

test('never twice', () => {
  assert.equal(publishProblem(post(), 'instagram', { ...ok, publication: 'published' }), 'Already published on Instagram.');
  assert.equal(publishProblem(post(), 'instagram', { ...ok, publication: 'processing' }), 'Publishing on Instagram is in progress.');
});

test('Instagram photos are JPEG only; Threads also takes PNG', () => {
  assert.equal(publishProblem(post({ mediaPath: 'u/p/a.png' }), 'instagram', ok), 'Instagram only accepts JPEG photos. Re-export it as .jpg.');
  assert.equal(publishProblem(post({ mediaPath: 'u/p/a.png' }), 'threads', ok), null);
  assert.equal(publishProblem(post({ mediaPath: 'u/p/a.webp' }), 'threads', ok), 'Threads doesn’t accept .webp files. Use a JPEG or PNG.');
  assert.equal(publishProblem(post({ mediaPath: 'u/p/a.gif' }), 'instagram', ok), 'Instagram only accepts JPEG photos. Re-export it as .jpg.');
  assert.equal(publishProblem(post({ mediaPath: 'u/p/a.webm', mediaType: 'video' }), 'instagram', ok), 'Instagram doesn’t accept .webm video. Use MP4 or MOV.');
  assert.equal(publishProblem(post({ mediaPath: 'u/p/a.mov', mediaType: 'video', format: 'reel' }), 'threads', ok), null);
});

test('media needs: Instagram always, Threads has no Stories', () => {
  assert.equal(publishProblem(post({ mediaPath: null, mediaType: null }), 'instagram', ok), 'Instagram needs a photo or video.');
  assert.equal(publishProblem(post({ mediaPath: null, mediaType: null }), 'threads', ok), null);
  assert.equal(publishProblem(post({ format: 'story' }), 'threads', ok), 'Threads has no Stories.');
});

test('length limits at their edges', () => {
  const tags: string[] = [];
  const at = (length: number) => post({ caption: 'x'.repeat(length), hashtags: tags });
  assert.equal(publishProblem(at(2200), 'instagram', ok), null);
  assert.equal(publishProblem(at(2201), 'instagram', ok), 'The text is 2,201 characters; Instagram allows 2,200.');
  assert.equal(publishProblem(at(500), 'threads', ok), null);
  assert.equal(publishProblem(at(501), 'threads', ok), 'The text is 501 characters; Threads allows 500.');
  assert.equal(publishProblem(post({ hashtags: Array.from({ length: 31 }, (_, i) => `t${i}`) }), 'instagram', ok), 'Instagram allows 30 hashtags; this post has 31.');
});

test('the text sent is the caption, a blank line, then the hashtags', () => {
  assert.equal(postedText('Hello', ['one', 'two']), 'Hello\n\n#one #two');
  assert.equal(postedText('Hello', []), 'Hello');
});

test('the container each format becomes', () => {
  assert.deepEqual(containerSpec(post(), 'instagram', 'https://s/a.jpg'), { kind: 'image', mediaUrl: 'https://s/a.jpg', text: 'Hello there\n\n#one #two' });
  assert.equal(containerSpec(post({ mediaPath: 'a.mp4', mediaType: 'video' }), 'instagram', 'u').kind, 'video');
  assert.equal(containerSpec(post({ format: 'reel', mediaPath: 'a.mp4', mediaType: 'video' }), 'threads', 'u').kind, 'video');
  assert.equal(containerSpec(post({ format: 'story' }), 'instagram', 'u').kind, 'story_image');
  assert.equal(containerSpec(post({ format: 'story', mediaPath: 'a.mp4', mediaType: 'video' }), 'instagram', 'u').kind, 'story_video');
  assert.deepEqual(containerSpec(post({ mediaPath: null, mediaType: null }), 'threads', null), { kind: 'text', text: 'Hello there\n\n#one #two' });
});
```

- [ ] **Step 2: Run it.** `npx vitest run lib/meta/publish-rules.test.ts` → FAIL.

- [ ] **Step 3: Write `lib/meta/publish-rules.ts`:**

```ts
import { postedLength } from '@/lib/social/month';
import type { SocialPost } from '@/lib/social/types';
import { META_LABEL, type ContainerSpec, type MetaPlatform } from '@/lib/meta/types';

export type PublishablePost = Pick<SocialPost, 'status' | 'platforms' | 'format' | 'caption' | 'hashtags' | 'mediaPath' | 'mediaType'>;
export type PublishContext = { connection: 'connected' | 'reconnect_required' | null; publication: 'processing' | 'published' | null; dirty: boolean };

const TEXT_LIMIT: Record<MetaPlatform, number> = { instagram: 2200, threads: 500 };
const IG_HASHTAGS = 30;
const IMAGES: Record<MetaPlatform, string[]> = { instagram: ['jpg', 'jpeg'], threads: ['jpg', 'jpeg', 'png'] };
const VIDEOS = ['mp4', 'mov'];

const extension = (path: string) => path.slice(path.lastIndexOf('.') + 1).toLowerCase();

/** The words exactly as they will be posted, and as the confirm sheet shows them. */
export function postedText(caption: string, hashtags: string[]) {
  const tags = hashtags.map((tag) => `#${tag}`).join(' ');
  return tags ? `${caption}\n\n${tags}` : caption;
}

/** Why this post cannot go to this platform now, or null. Checked in the drawer and again on the server. */
export function publishProblem(post: PublishablePost, platform: MetaPlatform, context: PublishContext): string | null {
  const name = META_LABEL[platform];
  if (!context.connection) return `Connect ${name} in Settings first.`;
  if (context.connection === 'reconnect_required') return `Reconnect ${name} in Settings.`;
  if (context.dirty || (post.status !== 'ready' && post.status !== 'published')) return 'Save the post and mark it ready first.';
  if (!post.platforms.includes(platform)) return `Add ${name} to this post’s platforms first.`;
  if (context.publication === 'published') return `Already published on ${name}.`;
  if (context.publication === 'processing') return `Publishing on ${name} is in progress.`;

  if (post.format === 'story' && platform === 'threads') return 'Threads has no Stories.';
  if (!post.mediaPath) {
    if (platform === 'instagram') return 'Instagram needs a photo or video.';
  } else if (post.mediaType === 'video') {
    const kind = extension(post.mediaPath);
    if (!VIDEOS.includes(kind)) return `${name} doesn’t accept .${kind} video. Use MP4 or MOV.`;
  } else {
    const kind = extension(post.mediaPath);
    if (!IMAGES[platform].includes(kind)) {
      return platform === 'instagram' ? 'Instagram only accepts JPEG photos. Re-export it as .jpg.' : `Threads doesn’t accept .${kind} files. Use a JPEG or PNG.`;
    }
  }

  const length = postedLength(post.caption, post.hashtags);
  if (length > TEXT_LIMIT[platform]) return `The text is ${length.toLocaleString('en-IN')} characters; ${name} allows ${TEXT_LIMIT[platform].toLocaleString('en-IN')}.`;
  if (platform === 'instagram' && post.hashtags.length > IG_HASHTAGS) return `Instagram allows ${IG_HASHTAGS} hashtags; this post has ${post.hashtags.length}.`;
  return null;
}

/** What to ask Meta to make. Call only after publishProblem returned null. */
export function containerSpec(post: PublishablePost, platform: MetaPlatform, mediaUrl: string | null): ContainerSpec {
  const text = postedText(post.caption, post.hashtags);
  if (!post.mediaPath || !mediaUrl) return { kind: 'text', text };
  const video = post.mediaType === 'video';
  if (post.format === 'story' && platform === 'instagram') return video ? { kind: 'story_video', mediaUrl, text } : { kind: 'story_image', mediaUrl, text };
  return video ? { kind: 'video', mediaUrl, text } : { kind: 'image', mediaUrl, text };
}
```

Check that `postedLength` counts exactly what `postedText` produces: `caption.length + 2 + tags.length`. It does (`lib/social/month.ts:110`).

- [ ] **Step 4: Run it.** `npx vitest run lib/meta` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/meta/publish-rules.ts lib/meta/publish-rules.test.ts
git commit -m "Instagram and Threads: what may be published, and how"
```

---

### Task 5: Config, client, connections and OAuth routes

**Files:**
- Create: `lib/meta/config.ts`, `lib/meta/client.ts`, `lib/meta/connection.ts`, `app/auth/meta/[platform]/start/route.ts`, `app/auth/meta/[platform]/callback/route.ts`

**Interfaces:**
- Consumes: Tasks 1–2; `signState`, `verifyState`, `OAUTH_STATE_MAX_AGE_SEC` (`lib/security/oauth-state.ts`); `encryptCredential`, `decryptCredential`, `credentialEncryptionReady` (`lib/crypto/credentials.ts`); `getAuthenticatedUserId` (`lib/auth/session.ts`); `createAdminClient`.
- Produces:
  - config.ts:

    ```ts
    metaCredentials(platform): { clientId: string; clientSecret: string } | null
    metaConfigured(platform): boolean
    isMetaPlatform(value: unknown): value is MetaPlatform
    redirectUri(platform, origin: string): string
    ```

  - client.ts:

    ```ts
    class MetaError extends Error { kind: 'auth' | 'rejected' | 'unavailable' }
    callMeta(request: MetaRequest): Promise<Record<string, unknown>>
    ```

  - connection.ts:

    ```ts
    listConnections(userId): Promise<ConnectionSummary[]>
    saveConnection(userId, platform, { accountId, username, accessToken, expiresAt }): Promise<void>
    deleteConnection(userId, platform): Promise<void>
    usableToken(userId, platform): Promise<{ accountId: string; username: string; token: string } | { error: 'none' | 'reconnect' }>
    markReconnect(userId, platform): Promise<void>
    ```

- [ ] **Step 1: Write `lib/meta/config.ts`:**

```ts
import 'server-only';

import { META_PLATFORMS, type MetaPlatform } from '@/lib/meta/types';

const ENV: Record<MetaPlatform, { id: string; secret: string }> = {
  instagram: { id: 'INSTAGRAM_APP_ID', secret: 'INSTAGRAM_APP_SECRET' },
  threads: { id: 'THREADS_APP_ID', secret: 'THREADS_APP_SECRET' },
};

export function isMetaPlatform(value: unknown): value is MetaPlatform {
  return typeof value === 'string' && (META_PLATFORMS as string[]).includes(value);
}

export function metaCredentials(platform: MetaPlatform) {
  const clientId = process.env[ENV[platform].id]?.trim();
  const clientSecret = process.env[ENV[platform].secret]?.trim();
  if (!clientId || !/^\d{5,32}$/.test(clientId) || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function metaConfigured(platform: MetaPlatform) {
  return metaCredentials(platform) !== null;
}

/** Built from the request's own origin, so local and production each use their registered URL. */
export function redirectUri(platform: MetaPlatform, origin: string) {
  return `${origin}/auth/meta/${platform}/callback`;
}

/** The httpOnly cookie holding the signed OAuth state, scoped to this platform's routes. */
export const metaStateCookie = (platform: MetaPlatform) => `orbis-meta-${platform}-state`;
```

- [ ] **Step 2: Write `lib/meta/client.ts`:**

```ts
import 'server-only';

import type { MetaRequest } from '@/lib/meta/requests';
import { classifyMetaError } from '@/lib/meta/tokens';

const TIMEOUT_MS = 8_000;

export class MetaError extends Error {
  constructor(readonly kind: 'auth' | 'rejected' | 'unavailable', message: string) {
    super(message);
    this.name = 'MetaError';
  }
}

/**
 * Runs one Meta request. The URL carries a token (and for the token exchange,
 * the app secret), so it is never logged: failures are reported by kind only.
 */
export async function callMeta(request: MetaRequest): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(request.url, {
      method: request.method,
      body: request.body,
      headers: request.body ? { 'content-type': 'application/x-www-form-urlencoded' } : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new MetaError('unavailable', 'Meta isn’t responding right now.');
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // An empty or non-JSON body is classified by status alone.
  }
  if (!response.ok || (json && typeof json === 'object' && 'error' in json)) {
    const problem = classifyMetaError(response.ok ? 400 : response.status, json);
    throw new MetaError(problem.kind, problem.message);
  }
  return (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
}
```

- [ ] **Step 3: Write `lib/meta/connection.ts`:**

```ts
import 'server-only';

import { decryptCredential, encryptCredential } from '@/lib/crypto/credentials';
import { callMeta, MetaError } from '@/lib/meta/client';
import { refreshToken } from '@/lib/meta/requests';
import { needsRefresh, parseLongToken } from '@/lib/meta/tokens';
import type { ConnectionSummary, MetaPlatform } from '@/lib/meta/types';
import { createAdminClient } from '@/lib/supabase/admin';

const MISSING_TABLE = ['PGRST205', 'PGRST204', '42P01'];

/** Which platforms are connected, with no token. Empty if the migration is not applied yet. */
export async function listConnections(userId: string): Promise<ConnectionSummary[]> {
  const { data, error } = await createAdminClient().from('social_connections').select('platform,username,status').eq('user_id', userId);
  if (error) {
    if (!MISSING_TABLE.includes(error.code ?? '')) console.error('Loading Meta connections failed', error.code);
    return [];
  }
  return (data ?? []).map((row) => ({ platform: row.platform, username: row.username, status: row.status }));
}

export async function saveConnection(userId: string, platform: MetaPlatform, input: { accountId: string; username: string; accessToken: string; expiresAt: string }) {
  const { error } = await createAdminClient().from('social_connections').upsert({
    user_id: userId, platform, account_id: input.accountId, username: input.username.slice(0, 64),
    access_token_encrypted: encryptCredential(input.accessToken), expires_at: input.expiresAt, status: 'connected',
  }, { onConflict: 'user_id,platform' });
  if (error) throw new Error(`Saving the ${platform} connection failed (${error.code}).`);
}

export async function deleteConnection(userId: string, platform: MetaPlatform) {
  const { error } = await createAdminClient().from('social_connections').delete().eq('user_id', userId).eq('platform', platform);
  if (error) throw new Error(`Removing the ${platform} connection failed (${error.code}).`);
}

export async function markReconnect(userId: string, platform: MetaPlatform) {
  await createAdminClient().from('social_connections').update({ status: 'reconnect_required' }).eq('user_id', userId).eq('platform', platform);
}

/**
 * A token ready to use, refreshed first when it has under a week left. A
 * refresh that fails while the old token still works is not an error (Meta
 * refuses to refresh tokens under a day old); an expired token is a reconnect.
 */
export async function usableToken(userId: string, platform: MetaPlatform): Promise<{ accountId: string; username: string; token: string } | { error: 'none' | 'reconnect' }> {
  const admin = createAdminClient();
  const { data, error } = await admin.from('social_connections').select('account_id,username,access_token_encrypted,expires_at,status').eq('user_id', userId).eq('platform', platform).maybeSingle();
  if (error || !data) return { error: 'none' };
  if (data.status === 'reconnect_required') return { error: 'reconnect' };
  const now = new Date();
  if (new Date(data.expires_at) <= now) {
    await markReconnect(userId, platform);
    return { error: 'reconnect' };
  }
  let token = decryptCredential(data.access_token_encrypted);
  if (needsRefresh(data.expires_at, now)) {
    try {
      const fresh = parseLongToken(await callMeta(refreshToken(platform, token)), now);
      if (fresh) {
        await admin.from('social_connections').update({ access_token_encrypted: encryptCredential(fresh.accessToken), expires_at: fresh.expiresAt }).eq('user_id', userId).eq('platform', platform);
        token = fresh.accessToken;
      }
    } catch (caught) {
      if (caught instanceof MetaError && caught.kind === 'auth') {
        await markReconnect(userId, platform);
        return { error: 'reconnect' };
      }
    }
  }
  return { accountId: data.account_id, username: data.username, token };
}
```

- [ ] **Step 4: Write `app/auth/meta/[platform]/start/route.ts`** (read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` first; `params` is a Promise):

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/auth/session';
import { credentialEncryptionReady } from '@/lib/crypto/credentials';
import { OAUTH_STATE_MAX_AGE_SEC, signState } from '@/lib/security/oauth-state';
import { isMetaPlatform, metaCredentials, metaStateCookie, redirectUri } from '@/lib/meta/config';
import { authorizeUrl } from '@/lib/meta/requests';

/**
 * Sends the person to Instagram or Threads to let Orbis read their posts and
 * publish what they confirm. A signed state bound to this user rides along in
 * the URL and in a cookie; the callback refuses any return without both.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!isMetaPlatform(platform)) return NextResponse.redirect(new URL('/?tab=settings', request.url));
  const userId = await getAuthenticatedUserId();
  if (!userId) return NextResponse.redirect(new URL('/login', request.url));

  const credentials = metaCredentials(platform);
  if (!credentials || !credentialEncryptionReady()) return NextResponse.redirect(new URL(`/?tab=settings&meta=${platform}-not-configured`, request.url));

  const signed = signState(userId, platform);
  const response = NextResponse.redirect(authorizeUrl(platform, { clientId: credentials.clientId, redirectUri: redirectUri(platform, request.nextUrl.origin), state: signed.state }));
  response.cookies.set(metaStateCookie(platform), signed.cookieValue, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: `/auth/meta/${platform}`, maxAge: OAUTH_STATE_MAX_AGE_SEC,
  });
  return response;
}
```

Route files may only export handlers and route config, which is why the cookie name lives in `lib/meta/config.ts`.

- [ ] **Step 5: Write `app/auth/meta/[platform]/callback/route.ts`:**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/auth/session';
import { verifyState } from '@/lib/security/oauth-state';
import { isMetaPlatform, metaCredentials, metaStateCookie, redirectUri } from '@/lib/meta/config';
import { callMeta, MetaError } from '@/lib/meta/client';
import { saveConnection } from '@/lib/meta/connection';
import { codeExchange, longLivedExchange, me } from '@/lib/meta/requests';
import { parseLongToken, parseMe, parseShortToken, stripCode } from '@/lib/meta/tokens';

/**
 * Where Instagram or Threads sends the person back with a one-time code. The
 * code is traded for a 60-day token at once; the account id comes from /me,
 * never from the exchange response (its user_id is a number JSON can't hold).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!isMetaPlatform(platform)) return NextResponse.redirect(new URL('/?tab=settings', request.url));
  const back = (reason: string) => {
    const response = NextResponse.redirect(new URL(`/?tab=settings&meta=${platform}-${reason}`, request.url));
    response.cookies.set(metaStateCookie(platform), '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: `/auth/meta/${platform}`, maxAge: 0 });
    return response;
  };

  const userId = await getAuthenticatedUserId();
  if (!userId) return NextResponse.redirect(new URL('/login', request.url));
  const url = request.nextUrl;
  const code = url.searchParams.get('code');
  if (url.searchParams.get('error') || !code) return back('cancelled');
  if (!verifyState(request.cookies.get(metaStateCookie(platform))?.value, url.searchParams.get('state'), userId, platform)) return back('failed');
  const credentials = metaCredentials(platform);
  if (!credentials) return back('not-configured');

  try {
    const short = parseShortToken(await callMeta(codeExchange(platform, { ...credentials, redirectUri: redirectUri(platform, url.origin), code: stripCode(code) })));
    if (!short) return back('failed');
    const long = parseLongToken(await callMeta(longLivedExchange(platform, { clientSecret: credentials.clientSecret, token: short })), new Date());
    // A 1-hour token would silently stop working; refuse rather than keep it.
    if (!long) return back('failed');
    const account = parseMe(platform, await callMeta(me(platform, long.accessToken)));
    if (!account) return back('failed');
    await saveConnection(userId, platform, { ...account, accessToken: long.accessToken, expiresAt: long.expiresAt });
  } catch (caught) {
    if (!(caught instanceof MetaError)) console.error(`Connecting ${platform} failed`, caught instanceof Error ? caught.message : 'unknown');
    return back(caught instanceof MetaError && caught.kind === 'rejected' ? 'rejected' : 'failed');
  }
  return back('connected');
}
```


- [ ] **Step 6: Verify.** `npx tsc --noEmit && npx eslint lib/meta app/auth/meta` → clean. Then `npx vitest run` → all pass.

- [ ] **Step 7: Commit.**

```bash
git add lib/meta/config.ts lib/meta/client.ts lib/meta/connection.ts "app/auth/meta"
git commit -m "Instagram and Threads: connect with Meta and keep the token fresh"
```

---

### Task 6: Settings rows, notices and copy

**Files:**
- Modify:
  - `lib/providers/status.ts`: `AppConnections` gains `meta` and it is loaded in `getAppConnections`.
  - `components/settings/app-integrations.tsx`: Instagram and Threads rows.
  - `components/settings/settings-sheet.tsx`: notices and the Connections note.
  - `components/app-shell.tsx`: read `?meta=`.
  - `app/social/meta-actions.ts`: create it, with `disconnectMetaAction` only for now.
  - `app/privacy/page.tsx`: a section.
  - `lib/site.ts`: bump `LEGAL_UPDATED`.

**Interfaces:**
- Consumes: `listConnections`, `metaConfigured`, `deleteConnection`, `ConnectionSummary`, `META_PLATFORMS`, `META_LABEL`.
- Produces:
  - `AppConnections.meta: { connections: ConnectionSummary[]; configured: Record<MetaPlatform, boolean> }`;
  - `disconnectMetaAction(platform: unknown): Promise<{ success: boolean; message: string }>`.

- [ ] **Step 1: Loading.** In `lib/providers/status.ts`:
  - add to `AppConnections`: `meta: { connections: ConnectionSummary[]; configured: Record<MetaPlatform, boolean> };`;
  - initialise with `meta: { connections: [], configured: { instagram: metaConfigured('instagram'), threads: metaConfigured('threads') } }` in `result`;
  - inside the `try`, after the existing reads: `result.meta.connections = await listConnections(userId);`.

  The imports are `listConnections` from `@/lib/meta/connection`, `metaConfigured` from `@/lib/meta/config`, and the types from `@/lib/meta/types`.

- [ ] **Step 2: The disconnect action.** Write `app/social/meta-actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { isMetaPlatform } from '@/lib/meta/config';
import { deleteConnection } from '@/lib/meta/connection';
import { META_LABEL } from '@/lib/meta/types';

type Result = { success: boolean; message: string };
const SIGN_IN: Result = { success: false, message: 'Sign in again to do this.' };

/** Forgets the token. Meta's own permission is removed in the Instagram or Threads app. */
export async function disconnectMetaAction(platform: unknown): Promise<Result> {
  const userId = (await requireUser())?.userId;
  if (!userId) return SIGN_IN;
  if (!isMetaPlatform(platform)) return { success: false, message: 'That connection is not known.' };
  try {
    await deleteConnection(userId, platform);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Disconnect failed');
    return { success: false, message: `${META_LABEL[platform]} could not be disconnected. Try again.` };
  }
  revalidatePath('/');
  return { success: true, message: `${META_LABEL[platform]} disconnected. To remove Orbis entirely, also remove it in ${META_LABEL[platform]}’s settings under Website permissions.` };
}
```

- [ ] **Step 3: Settings rows.** In `components/settings/app-integrations.tsx`:
  1. Give `AppHead` an optional `badge` prop that defaults to `'Read-only'`, and render `{badge}` in place of the literal `Read-only`.
  2. After the Google `<article>`, add one article per `META_PLATFORMS` entry:

```tsx
{META_PLATFORMS.map((platform) => {
  const linked = connections.meta.connections.find((item) => item.platform === platform) ?? null;
  const expired = linked?.status === 'reconnect_required';
  const configured = connections.meta.configured[platform];
  const name = META_LABEL[platform];
  return (
    <article className="pf-app" key={platform}>
      <AppHead
        tile={<b>{platform === 'instagram' ? 'IG' : '@'}</b>}
        name={name}
        badge="Publishes only when you confirm"
        detail={linked ? `@${linked.username} · posts and stats for Social` : 'Your posts and their stats in Social, and publishing when you confirm'}
        status={linked ? <Status state={expired ? 'warn' : 'on'}>{expired ? 'Reconnect' : 'Connected'}</Status> : <Status state="off">{configured ? 'Not connected' : 'Not set up'}</Status>}
      />
      {!configured && <p className="fd-note tight">Not set up on the server yet.</p>}
      {configured && (
        <div className="fd-act pf-act">
          {(!linked || expired) && <a className="fd-button" href={`/auth/meta/${platform}/start`}>{expired ? `Reconnect ${name}` : `Connect ${name}`}</a>}
          {linked && <button className="fd-link alert" type="button" disabled={isPending} onClick={() => run(`Disconnect ${name}? Orbis will stop showing its stats and can’t publish there.`, () => safeAction(disconnectMetaAction)(platform))}><Unplug size={13} aria-hidden="true" /> Disconnect</button>}
        </div>
      )}
    </article>
  );
})}
```

The imports are `META_PLATFORMS` and `META_LABEL` from `@/lib/meta/types`, and `disconnectMetaAction` from `@/app/social/meta-actions`.

- [ ] **Step 4: Notices and copy.** In `components/settings/settings-sheet.tsx`:
  1. Add to `GOOGLE_NOTICE`, for each of `instagram` and `threads` (the label is `Instagram` or `Threads`):

```ts
'instagram-connected': { text: 'Instagram connected.', success: true },
'instagram-cancelled': { text: 'Instagram connection was cancelled.', success: false },
'instagram-not-configured': { text: 'Instagram isn’t set up on the server yet.', success: false },
'instagram-rejected': { text: 'Instagram refused the connection. Check the account is Professional and added as a tester.', success: false },
'instagram-failed': { text: 'Instagram could not be connected. Try again.', success: false },
```

     Add the same five keys with `threads-` and "Threads". For `threads-rejected` the text is `'Threads refused the connection. Check the account is added as a Threads tester.'`.
  2. Change the Connections group note to: `"Everything Orbis reads from is read-only. Instagram and Threads can also publish a post, only when you press Publish and confirm. Disconnect at any time."`

  In `components/app-shell.tsx`, in the one-time URL read:
  - `const notice = url.searchParams.get('gmail') ?? url.searchParams.get('meta');`
  - delete `meta` from the URL alongside `gmail`, and add `|| url.searchParams.has('meta')` to the condition that rewrites the URL.

- [ ] **Step 5: Privacy.** In `app/privacy/page.tsx`:
  - add to the "Who we share it with" list: `<li><strong>Instagram and Threads (Meta)</strong> — only if you connect them: Orbis reads your own posts and their stats, and sends a post only when you press Publish and confirm, with a link to that one file that stops working after an hour</li>`;
  - add to "What we hold": `<li>Instagram and Threads access tokens, encrypted, readable only by Orbis&apos;s server, deleted when you disconnect or delete your account</li>`.

  Bump `LEGAL_UPDATED` in `lib/site.ts` to `'2026-09-30'`.

- [ ] **Step 6: Verify.** `npx tsc --noEmit && npx eslint components/settings components/app-shell.tsx lib/providers app/social app/privacy` → clean. `npx vitest run` → all pass. Search for other `AppConnections` literals: `grep -rn "brokerSetupMessages: {}" lib components tests`. Add `meta: { connections: [], configured: { instagram: false, threads: false } }` to each one found, including any test fixture.

- [ ] **Step 7: Commit.**

```bash
git add lib/providers/status.ts components/settings components/app-shell.tsx app/social/meta-actions.ts app/privacy/page.tsx lib/site.ts
git commit -m "Instagram and Threads: Settings rows, notices and privacy copy"
```

---

### Task 7: Publication records, live stats and auto-mark

**Files:**
- Modify:
  - `lib/social/repository.ts`: `setStatus` takes an optional `at`, and a new `recordPublishedElsewhere`.
  - `app/social/actions.ts`: unmarking deletes publications.
- Create: `lib/meta/publications.ts`, `lib/meta/live.ts`, `app/api/social/live/route.ts`

**Interfaces:**
- Consumes: Tasks 2–5; `listMonth`, `getPost`, `setStatus`, `signedMediaUrl` (repository).
- Produces:
  - repository:

    ```ts
    setStatus(userId, id, status, published?: { platform: string; link: string | null; at?: string })
    recordPublishedElsewhere(userId: string, id: string, platform: string): Promise<void>
    ```

  - publications.ts:

    ```ts
    listPublications(userId, postIds: string[]): Promise<PublicationRow[]>
    claimPublication(userId, postId, platform): Promise<string | null>
    setContainer(id, containerId)
    completePublication(userId, publication: { id; postId; platform }, result: { externalId; permalink; publishedAt; source: 'orbis' | 'matched' })
    dropPublication(id)
    deletePostPublications(userId, postId)
    ```

    with `type PublicationRow = { id: string; postId: string; platform: MetaPlatform; status: 'processing' | 'published'; containerId: string | null; externalId: string | null; createdAt: string }`.
  - live.ts: `loadLive(userId: string, period: string): Promise<SocialLive>`.

- [ ] **Step 1: Repository changes.** In `lib/social/repository.ts`:
  1. Change `setStatus`'s `published` parameter type to `{ platform: string; link: string | null; at?: string }`, and the published row to `published_at: published.at ?? new Date().toISOString()`.
  2. Add:

```ts
/** A post already published on one platform went out on another: history only, the post's own fields keep the first. */
export async function recordPublishedElsewhere(userId: string, id: string, platform: string) {
  const supabase = await createClient();
  const post = await readPost(supabase, userId, id);
  if (!post) return;
  await record(supabase, userId, { ...post, published: post.published ? { ...post.published, platform } : null }, 'published', null, post);
}
```

`readPost` and `record` are existing private functions in this file. `snapshotOf(post)` carries `published`, so the history entry names the second platform.

- [ ] **Step 2: Publications.** Write `lib/meta/publications.ts`:

```ts
import 'server-only';

import { recordPublishedElsewhere, setStatus, getPost } from '@/lib/social/repository';
import type { MetaPlatform } from '@/lib/meta/types';
import { createAdminClient } from '@/lib/supabase/admin';

export type PublicationRow = { id: string; postId: string; platform: MetaPlatform; status: 'processing' | 'published'; containerId: string | null; externalId: string | null; createdAt: string };

const toRow = (row: Record<string, unknown>): PublicationRow => ({
  id: row.id as string, postId: row.post_id as string, platform: row.platform as MetaPlatform, status: row.status as PublicationRow['status'],
  containerId: (row.container_id as string | null) ?? null, externalId: (row.external_id as string | null) ?? null, createdAt: row.created_at as string,
});

export async function listPublications(userId: string, postIds: string[]) {
  if (!postIds.length) return [];
  const { data, error } = await createAdminClient().from('social_publications').select('id,post_id,platform,status,container_id,external_id,created_at').eq('user_id', userId).in('post_id', postIds);
  if (error) return [];
  return (data ?? []).map(toRow);
}

/** Claims the (post, platform) pair. null when a publication already exists, so a second tap never makes a second post. */
export async function claimPublication(userId: string, postId: string, platform: MetaPlatform) {
  const { data, error } = await createAdminClient().from('social_publications').insert({ user_id: userId, post_id: postId, platform, status: 'processing', source: 'orbis' }).select('id').single();
  if (error) return null;
  return data.id as string;
}

export async function setContainer(id: string, containerId: string) {
  await createAdminClient().from('social_publications').update({ container_id: containerId }).eq('id', id);
}

export async function dropPublication(id: string) {
  await createAdminClient().from('social_publications').delete().eq('id', id).eq('status', 'processing');
}

export async function deletePostPublications(userId: string, postId: string) {
  await createAdminClient().from('social_publications').delete().eq('user_id', userId).eq('post_id', postId);
}

/**
 * Records that a post is out on a platform. The first platform also sets the
 * post itself to published with that time and link; a second only adds history.
 */
export async function completePublication(userId: string, publication: { id: string | null; postId: string; platform: MetaPlatform }, result: { externalId: string; permalink: string | null; publishedAt: string; source: 'orbis' | 'matched' }) {
  const admin = createAdminClient();
  const values = { status: 'published', external_id: result.externalId, permalink: result.permalink, published_at: result.publishedAt, source: result.source };
  const { error } = publication.id
    ? await admin.from('social_publications').update(values).eq('id', publication.id)
    : await admin.from('social_publications').insert({ ...values, user_id: userId, post_id: publication.postId, platform: publication.platform });
  // 23505: another run recorded this pair first; that is the same outcome.
  if (error && error.code !== '23505') throw new Error(`Recording the publication failed (${error.code}).`);
  const post = await getPost(userId, publication.postId);
  if (!post) return;
  if (post.status === 'ready') await setStatus(userId, post.id, 'published', { platform: publication.platform, link: result.permalink, at: result.publishedAt });
  else if (post.status === 'published') await recordPublishedElsewhere(userId, post.id, publication.platform);
}
```

- [ ] **Step 3: Unmarking.** In `app/social/actions.ts` `markPublishedAction`, in the `publish === null` branch, after `const post = await setStatus(userId, id, 'ready');`, add `await deletePostPublications(userId, id);` (import from `@/lib/meta/publications`). Change that branch's success message to `'Marked as not published. It is ready again. Nothing was removed from Instagram or Threads.'`.

- [ ] **Step 4: Live.** Write `lib/meta/live.ts`:

```ts
import 'server-only';

import { callMeta, MetaError } from '@/lib/meta/client';
import { markReconnect, usableToken, listConnections } from '@/lib/meta/connection';
import { matchPosts, type PlannedPost } from '@/lib/meta/match';
import { completePublication, dropPublication, listPublications } from '@/lib/meta/publications';
import { finishProcessing } from '@/lib/meta/publish';
import { mediaInsights, monthMedia } from '@/lib/meta/requests';
import type { LivePost, LiveStats, MetaPlatform, PlatformLive, SocialLive } from '@/lib/meta/types';
import { listMonth } from '@/lib/social/repository';

const STUCK_MS = 24 * 60 * 60_000;

/** The month as Unix seconds in India time: [1st 00:00, next 1st 00:00). */
function monthRange(period: string) {
  const [year, month] = period.split('-').map(Number);
  const start = Date.UTC(year, month - 1, 1) - 330 * 60_000;
  const end = Date.UTC(year, month, 1) - 330 * 60_000;
  return { since: Math.floor(start / 1000), until: Math.floor(end / 1000) };
}

function statsFrom(json: Record<string, unknown>): LiveStats {
  const values: Record<string, number> = {};
  for (const item of (json.data as Array<{ name?: string; values?: Array<{ value?: number }>; total_value?: { value?: number } }>) ?? []) {
    const value = item.values?.[0]?.value ?? item.total_value?.value;
    if (item.name && typeof value === 'number') values[item.name] = value;
  }
  return {
    views: values.views, reach: values.reach, likes: values.likes, comments: values.comments ?? values.replies,
    saves: values.saved, shares: values.shares, reposts: values.reposts, quotes: values.quotes,
  };
}

async function platformLive(userId: string, platform: MetaPlatform, username: string, period: string, planned: PlannedPost[], publications: Awaited<ReturnType<typeof listPublications>>): Promise<PlatformLive> {
  const empty = (state: PlatformLive['state']): PlatformLive => ({ platform, username, state, posts: [], matchedPostIds: [], publications: {} });
  const access = await usableToken(userId, platform);
  if ('error' in access) return empty(access.error === 'reconnect' ? 'reconnect' : 'unavailable');
  try {
    // Finish or give up on publications left processing (the app was closed mid-way).
    for (const row of publications.filter((item) => item.platform === platform && item.status === 'processing')) {
      if (Date.now() - new Date(row.createdAt).getTime() > STUCK_MS) await dropPublication(row.id);
      else await finishProcessing(userId, row, access).catch(() => undefined);
    }
    const listed = await callMeta(monthMedia(platform, access.accountId, access.token, monthRange(period)));
    const raw = (listed.data as Array<Record<string, unknown>>) ?? [];
    const posts: LivePost[] = await Promise.all(raw.map(async (item) => {
      const productType = (item.media_product_type as string | undefined) ?? null;
      let stats: LiveStats | null = null;
      try {
        stats = statsFrom(await callMeta(mediaInsights(platform, item.id as string, access.token, productType)));
      } catch {
        // One post's stats failing leaves the rest.
      }
      return {
        externalId: item.id as string, caption: ((item.caption ?? item.text) as string | undefined) ?? '', permalink: (item.permalink as string | undefined) ?? null,
        timestamp: item.timestamp as string, productType, thumbnail: (item.thumbnail_url as string | undefined) ?? null, stats,
      };
    }));
    const pairs = matchPosts(platform, planned, posts.filter((post) => !publications.some((row) => row.externalId === post.externalId)));
    const matched: string[] = [];
    for (const pair of pairs) {
      await completePublication(userId, { id: null, postId: pair.postId, platform }, {
        externalId: pair.live.externalId, permalink: pair.live.permalink, publishedAt: new Date(pair.live.timestamp.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')).toISOString(), source: 'matched',
      });
      matched.push(pair.postId);
    }
    const linked: Record<string, string> = {};
    for (const row of publications) if (row.platform === platform && row.externalId) linked[row.externalId] = row.postId;
    for (const pair of pairs) linked[pair.live.externalId] = pair.postId;
    return { platform, username, state: 'ok', posts, matchedPostIds: matched, publications: linked };
  } catch (caught) {
    if (caught instanceof MetaError && caught.kind === 'auth') {
      await markReconnect(userId, platform);
      return empty('reconnect');
    }
    return empty('unavailable');
  }
}

/** Everything the Social tab shows from Instagram and Threads for one month. */
export async function loadLive(userId: string, period: string): Promise<SocialLive> {
  const connections = await listConnections(userId);
  if (!connections.length) return { platforms: [] };
  const month = await listMonth(userId, period);
  const publications = await listPublications(userId, month.posts.map((post) => post.id));
  const planned: PlannedPost[] = month.posts.map((post) => ({
    id: post.id, platforms: post.platforms, status: post.status, plannedFor: post.plannedFor, period: post.period, caption: post.caption,
    publishedOn: publications.filter((row) => row.postId === post.id).map((row) => row.platform),
  }));
  const platforms = await Promise.all(connections.map((connection) => (connection.status === 'reconnect_required'
    ? Promise.resolve<PlatformLive>({ platform: connection.platform, username: connection.username, state: 'reconnect', posts: [], matchedPostIds: [], publications: {} })
    : platformLive(userId, connection.platform, connection.username, period, planned, publications))));
  return { platforms };
}
```

`finishProcessing` is produced by Task 8. To keep this task compiling and committable on its own, add in Step 4 a stub `export async function finishProcessing(..._args: unknown[]) {}` in `lib/meta/publish.ts`; Task 8 replaces it.

- [ ] **Step 5: The route.** Write `app/api/social/live/route.ts`, mirroring `app/api/home/mail/route.ts`:

```ts
import { homeRequester, NO_STORE } from '@/lib/home/route-auth';
import { loadLive } from '@/lib/meta/live';
import { PERIOD_PATTERN } from '@/lib/social/month';

// GET /api/social/live?period=2026-09-01 → Instagram and Threads posts, stats and new auto-marks for that month.
export async function GET(request: Request) {
  const requester = await homeRequester();
  if (!requester) return Response.json(null, { status: 401, headers: NO_STORE });
  const period = new URL(request.url).searchParams.get('period') ?? '';
  if (!PERIOD_PATTERN.test(period)) return Response.json(null, { status: 400, headers: NO_STORE });
  try {
    return Response.json(await loadLive(requester.userId, period), { headers: NO_STORE });
  } catch (error) {
    console.error('Social live failed', error instanceof Error ? error.message : 'unknown');
    return Response.json({ platforms: [] }, { headers: NO_STORE });
  }
}
```

- [ ] **Step 6: Verify.** `npx tsc --noEmit && npx eslint lib/meta lib/social app/api/social app/social` → clean. `npx vitest run` → all pass. Check that `PERIOD_PATTERN` accepts `YYYY-MM-01` (`lib/social/month.ts`); the client sends the period in that form.

- [ ] **Step 7: Commit.**

```bash
git add lib/social/repository.ts app/social/actions.ts lib/meta/publications.ts lib/meta/live.ts lib/meta/publish.ts app/api/social/live/route.ts
git commit -m "Instagram and Threads: live stats and auto-marking published posts"
```

---

### Task 8: Publishing

**Files:**
- Create or replace: `lib/meta/publish.ts`
- Modify: `app/social/meta-actions.ts` (add two actions)

**Interfaces:**
- Consumes: Tasks 2, 4, 5 and 7; `consumeRateLimit`-based `rateLimitRefusal`; `getPost`, `signedMediaUrl` (repository).
- Produces:

```ts
startPublish(userId, postId, platform): Promise<PublishResult>
checkPublish(userId, publicationId): Promise<PublishResult>
finishProcessing(userId, row: PublicationRow, access: { accountId; token }): Promise<PublishResult>
startPublishAction(postId: unknown, platform: unknown): Promise<PublishResult>
checkPublishAction(publicationId: unknown): Promise<PublishResult>
```

- [ ] **Step 1: Write `lib/meta/publish.ts`:**

```ts
import 'server-only';

import { callMeta, MetaError } from '@/lib/meta/client';
import { markReconnect, listConnections, usableToken } from '@/lib/meta/connection';
import { claimPublication, completePublication, dropPublication, listPublications, setContainer, type PublicationRow } from '@/lib/meta/publications';
import { containerSpec, publishProblem } from '@/lib/meta/publish-rules';
import { containerStatus, createContainer, mediaDetails, publishContainer } from '@/lib/meta/requests';
import { META_LABEL, type MetaPlatform, type PublishResult } from '@/lib/meta/types';
import { rateLimitRefusal } from '@/lib/security/rate-limit';
import { getPost, signedMediaUrl } from '@/lib/social/repository';
import { createAdminClient } from '@/lib/supabase/admin';

const failed = (message: string): PublishResult => ({ success: false, message });

function metaFailure(error: unknown, platform: MetaPlatform) {
  if (error instanceof MetaError) {
    if (error.kind === 'unavailable') return `${META_LABEL[platform]} isn’t responding right now. Try again in a minute.`;
    if (error.kind === 'auth') return `Reconnect ${META_LABEL[platform]} in Settings, then try again.`;
    return `${META_LABEL[platform]} said: ${error.message}`;
  }
  return `${META_LABEL[platform]} could not publish this. Try again.`;
}

/** Publishes a FINISHED container and records it; reports processing or failure otherwise. */
export async function finishProcessing(userId: string, row: PublicationRow, access: { accountId: string; token: string }): Promise<PublishResult> {
  const platform = row.platform;
  if (!row.containerId) {
    await dropPublication(row.id);
    return failed('Publishing didn’t finish. Try again.');
  }
  try {
    const status = await callMeta(containerStatus(platform, row.containerId, access.token));
    const code = (status.status_code ?? status.status) as string | undefined;
    if (code === 'IN_PROGRESS') return { success: true, message: `${META_LABEL[platform]} is still processing it.`, state: 'processing', publicationId: row.id };
    if (code !== 'FINISHED') {
      await dropPublication(row.id);
      const reason = typeof status.error_message === 'string' ? ` (${status.error_message.toLowerCase().replace(/_/g, ' ')})` : '';
      return failed(`${META_LABEL[platform]} couldn’t use this file${reason}. Nothing was posted.`);
    }
    const published = await callMeta(publishContainer(platform, access.accountId, access.token, row.containerId));
    const externalId = published.id as string;
    let permalink: string | null = null;
    let publishedAt = new Date().toISOString();
    try {
      const details = await callMeta(mediaDetails(platform, externalId, access.token));
      permalink = (details.permalink as string | undefined) ?? null;
      if (typeof details.timestamp === 'string') publishedAt = new Date(details.timestamp.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')).toISOString();
    } catch {
      // The post is out; the link can come from the next stats read.
    }
    await completePublication(userId, { id: row.id, postId: row.postId, platform }, { externalId, permalink, publishedAt, source: 'orbis' });
    return { success: true, message: `Published on ${META_LABEL[platform]}.`, state: 'published', permalink };
  } catch (error) {
    if (error instanceof MetaError && error.kind === 'auth') await markReconnect(userId, platform);
    // A publish call that failed may still have posted; keep the claim only while Meta could still be processing.
    if (!(error instanceof MetaError && error.kind === 'unavailable')) await dropPublication(row.id);
    return failed(metaFailure(error, platform));
  }
}

export async function startPublish(userId: string, postId: string, platform: MetaPlatform): Promise<PublishResult> {
  const post = await getPost(userId, postId);
  if (!post) return failed('That post no longer exists.');
  const connection = (await listConnections(userId)).find((item) => item.platform === platform) ?? null;
  const existing = (await listPublications(userId, [postId])).find((row) => row.platform === platform) ?? null;
  const problem = publishProblem(post, platform, { connection: connection?.status ?? null, publication: existing?.status ?? null, dirty: false });
  if (problem) return failed(problem);

  const refusal = await rateLimitRefusal(userId, platform === 'instagram' ? 'social_publish_instagram' : 'social_publish_threads');
  if (refusal) return failed(refusal);
  const access = await usableToken(userId, platform);
  if ('error' in access) return failed(`Reconnect ${META_LABEL[platform]} in Settings, then try again.`);

  const id = await claimPublication(userId, postId, platform);
  if (!id) return failed(`Publishing on ${META_LABEL[platform]} is already under way.`);
  try {
    const mediaUrl = post.mediaPath ? await signedMediaUrl(post.mediaPath) : null;
    if (post.mediaPath && !mediaUrl) {
      await dropPublication(id);
      return failed('The picture or video could not be prepared. Try again.');
    }
    const created = await callMeta(createContainer(platform, access.accountId, access.token, containerSpec(post, platform, mediaUrl)));
    const containerId = created.id as string;
    await setContainer(id, containerId);
    return await finishProcessing(userId, { id, postId, platform, status: 'processing', containerId, externalId: null, createdAt: new Date().toISOString() }, access);
  } catch (error) {
    await dropPublication(id);
    return failed(metaFailure(error, platform));
  }
}

export async function checkPublish(userId: string, publicationId: string): Promise<PublishResult> {
  const { data } = await createAdminClient().from('social_publications').select('id,post_id,platform,status,container_id,external_id,created_at').eq('id', publicationId).eq('user_id', userId).maybeSingle();
  if (!data) return failed('Publishing didn’t finish. Try again.');
  if (data.status === 'published') return { success: true, message: `Published on ${META_LABEL[data.platform as MetaPlatform]}.`, state: 'published', permalink: null };
  const row: PublicationRow = { id: data.id, postId: data.post_id, platform: data.platform, status: data.status, containerId: data.container_id, externalId: data.external_id, createdAt: data.created_at };
  const access = await usableToken(userId, row.platform);
  if ('error' in access) return failed(`Reconnect ${META_LABEL[row.platform]} in Settings, then try again.`);
  return finishProcessing(userId, row, access);
}
```

Check `signedMediaUrl`'s signature in `lib/social/repository.ts:323`. It takes a path and returns `string | null`; adapt the call if it differs.

- [ ] **Step 2: The actions.** Append to `app/social/meta-actions.ts`:

```ts
import { isUuid } from '@/lib/validate/id';
import { checkPublish, startPublish } from '@/lib/meta/publish';
import type { PublishResult } from '@/lib/meta/types';

/** Publishes a saved, ready post to one platform. Called only from the confirm sheet. */
export async function startPublishAction(postId: unknown, platform: unknown): Promise<PublishResult> {
  const userId = (await requireUser())?.userId;
  if (!userId) return SIGN_IN;
  if (!isUuid(postId) || !isMetaPlatform(platform)) return { success: false, message: 'That post is invalid.' };
  const result = await startPublish(userId, postId, platform);
  if (result.success) revalidatePath('/');
  return result;
}

/** Checks a video still being processed by Meta, and publishes it once it is ready. */
export async function checkPublishAction(publicationId: unknown): Promise<PublishResult> {
  const userId = (await requireUser())?.userId;
  if (!userId) return SIGN_IN;
  if (!isUuid(publicationId)) return { success: false, message: 'That is not a publication.' };
  const result = await checkPublish(userId, publicationId);
  if (result.success && result.state === 'published') revalidatePath('/');
  return result;
}
```

Merge the imports with the file's existing imports at the top; don't leave a second import block.

- [ ] **Step 3: Verify.** `npx tsc --noEmit && npx eslint lib/meta app/social` → clean. `npx vitest run` → all pass.

- [ ] **Step 4: Commit.**

```bash
git add lib/meta/publish.ts app/social/meta-actions.ts
git commit -m "Instagram and Threads: publish a confirmed post, waiting out video processing"
```

---

### Task 9: Social tab: stats, publish buttons, confirm sheet

**Files:**
- Create: `components/social/live-stats.tsx`, `components/social/publish-sheet.tsx`
- Modify: `components/social/social-screen.tsx`, `components/social/social-list.tsx`, `components/social/post-drawer.tsx`, `app/styles/atlas-social.css`

**Interfaces:**
- Consumes: `SocialLive`, `LivePost`, `LiveStats`, `META_LABEL`, `MetaPlatform`, `publishProblem`, `postedText`, `startPublishAction`, `checkPublishAction`.
- Produces:

```ts
formatStats(stats: LiveStats): string   // exported from live-stats.tsx for the drawer
<MonthLive live={SocialLive | null} postIds={string[]} />
<PostStatsLine post={SocialPost} live={SocialLive | null} />
<PublishSheet post={SocialPost} platform={MetaPlatform} username={string} onClose={() => void} onPublished={(message: string) => void} />
```

- `PostDrawer` gains the props `live: SocialLive | null`.

- [ ] **Step 1: Write `components/social/live-stats.tsx`:**

```tsx
'use client';

import { META_LABEL, type LiveStats, type SocialLive } from '@/lib/meta/types';
import type { SocialPost } from '@/lib/social/types';

const compact = (value: number) => new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

export function formatStats(stats: LiveStats) {
  const parts: string[] = [];
  if (stats.reach !== undefined) parts.push(`${compact(stats.reach)} reach`);
  else if (stats.views !== undefined) parts.push(`${compact(stats.views)} views`);
  if (stats.likes !== undefined) parts.push(`${compact(stats.likes)} likes`);
  if (stats.comments !== undefined) parts.push(`${compact(stats.comments)} comments`);
  if (stats.saves !== undefined) parts.push(`${compact(stats.saves)} saves`);
  if (stats.reposts !== undefined) parts.push(`${compact(stats.reposts)} reposts`);
  return parts.join(' · ');
}

/** One line per connected platform, and what went out that wasn't in the plan. */
export function MonthLive({ live }: { live: SocialLive | null }) {
  if (!live?.platforms.length) return null;
  return (
    <section className="so-live" aria-label="Instagram and Threads this month">
      {live.platforms.map((platform) => {
        const name = META_LABEL[platform.platform];
        if (platform.state === 'reconnect') return <p key={platform.platform} className="so-live-line">Reconnect {name} in Settings to see stats.</p>;
        if (platform.state === 'unavailable') return <p key={platform.platform} className="so-live-line">{name} stats unavailable right now.</p>;
        const reach = platform.posts.reduce((sum, post) => sum + (post.stats?.reach ?? post.stats?.views ?? 0), 0);
        const outside = platform.posts.filter((post) => !platform.publications[post.externalId]);
        return (
          <div key={platform.platform}>
            <p className="so-live-line"><strong>{name}</strong> · {platform.posts.length} {platform.posts.length === 1 ? 'post' : 'posts'} · {compact(reach)} {platform.platform === 'instagram' ? 'reach' : 'views'}</p>
            {outside.length > 0 && (
              <details className="so-outside">
                <summary>Posted outside your plan ({outside.length})</summary>
                <ul>{outside.map((post) => <li key={post.externalId}>{post.permalink ? <a href={post.permalink} target="_blank" rel="noopener noreferrer">{post.caption.slice(0, 60) || 'Untitled'}</a> : post.caption.slice(0, 60)}{post.stats ? ` · ${formatStats(post.stats)}` : ''}</li>)}</ul>
              </details>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** The small stats line under a published post, one platform after another. */
export function PostStatsLine({ post, live }: { post: SocialPost; live: SocialLive | null }) {
  if (!live || post.status !== 'published') return null;
  const lines = live.platforms.flatMap((platform) => {
    const externalId = Object.entries(platform.publications).find(([, postId]) => postId === post.id)?.[0];
    const stats = externalId ? platform.posts.find((item) => item.externalId === externalId)?.stats : null;
    return stats ? [`${META_LABEL[platform.platform]}: ${formatStats(stats)}`] : [];
  });
  return lines.length ? <small className="so-stats">{lines.join(' — ')}</small> : null;
}
```

- [ ] **Step 2: Write `components/social/publish-sheet.tsx`:**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { checkPublishAction, startPublishAction } from '@/app/social/meta-actions';
import { safeAction } from '@/lib/client/safe-action';
import { postedText } from '@/lib/meta/publish-rules';
import { META_LABEL, type MetaPlatform, type PublishResult } from '@/lib/meta/types';
import { formatLabel, type SocialPost } from '@/lib/social/types';

const POLL_MS = 5_000;
const GIVE_UP_MS = 5 * 60_000;

/** Shows exactly what will go out, and only its Publish button sends anything. */
export function PublishSheet({ post, platform, username, onClose, onPublished }: { post: SocialPost; platform: MetaPlatform; username: string; onClose: () => void; onPublished: (message: string) => void }) {
  const [state, setState] = useState<'confirm' | 'sending' | 'processing'>('confirm');
  const [error, setError] = useState<string | null>(null);
  const started = useRef(0);
  const name = META_LABEL[platform];

  function settle(result: PublishResult) {
    if (!result.success) {
      setState('confirm');
      setError(result.message);
    } else if (result.state === 'published') {
      onPublished(result.message);
    } else {
      setState('processing');
      if (Date.now() - started.current > GIVE_UP_MS) {
        onPublished('Still processing. Orbis will finish it the next time Social opens.');
        return;
      }
      setTimeout(() => { void safeAction(checkPublishAction)(result.publicationId).then(settle); }, POLL_MS);
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && state === 'confirm') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, state]);

  function publish() {
    setError(null);
    setState('sending');
    started.current = Date.now();
    void safeAction(startPublishAction)(post.id, platform).then(settle);
  }

  return (
    <div className="so-sheet" role="dialog" aria-modal="true" aria-labelledby="publish-title">
      <h3 id="publish-title">Publish to {name}</h3>
      <p className="so-sheet-who">@{username} · {formatLabel(post.format)}</p>
      {post.mediaUrl && (post.mediaType === 'video'
        ? <video src={post.mediaUrl} className="so-sheet-media" muted playsInline />
        // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived Storage URL
        : <img src={post.mediaUrl} alt="" className="so-sheet-media" />)}
      <pre className="so-sheet-text" aria-label="Text that will be posted">{postedText(post.caption, post.hashtags)}</pre>
      <p className="so-sheet-warn">This posts publicly on {name} right now. Orbis can’t delete it afterwards.</p>
      {error && <p className="so-problem" role="alert">{error}</p>}
      {state === 'processing' && <p className="so-message" role="status">Publishing… {name} is processing the video.</p>}
      <div className="fd-act">
        <button type="button" disabled={state !== 'confirm'} onClick={publish}>{state === 'confirm' ? `Publish to ${name}` : 'Publishing…'}</button>
        {state === 'confirm' && <button type="button" className="fd-link" onClick={onClose}>Cancel</button>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Social screen.** In `components/social/social-screen.tsx`:
  1. Add `const [live, setLive] = useState<SocialLive | null>(null);`.
  2. Add an effect keyed on `period` that fetches `/api/social/live?period=${period}` with `cache: 'no-store'`, sets `live` from `response.ok ? json : null`, and when `json.platforms` has any `matchedPostIds`, sets the notice `Marked N post(s) as published from Instagram/Threads.` and calls `load(period)` to pick up their new status. Guard it with a `live` flag in the cleanup, as `components/today/headsups.tsx` does.
  3. Render `<MonthLive live={live} />` right after the month header `div.so-month`.
  4. Pass `live={live}` to `PostDrawer`.
  5. Replace the footer note with: `"Plan here. Publish from Orbis to Instagram or Threads when you confirm, or record where a post went out."`

- [ ] **Step 4: List stats line.** In `components/social/social-list.tsx`, give `SocialList` an optional `live?: SocialLive | null` prop and render `<PostStatsLine post={post} live={live ?? null} />` inside each row after its existing meta line. Pass `live={live}` from `social-screen.tsx`.

- [ ] **Step 5: Drawer.** In `components/social/post-drawer.tsx`:
  1. Add the prop `live: SocialLive | null` (and include it in the props type).
  2. Add `const [sheet, setSheet] = useState<MetaPlatform | null>(null);`.
  3. Compute `const connected = (live?.platforms ?? []).filter((platform) => platform.state !== 'unavailable');`. A connected platform with state `reconnect` still shows its button, disabled with the reconnect reason.
  4. In the `.so-bar` actions, after the "Mark published" button, for each `platform` in `connected` whose `platform.platform` is in `saved.platforms`, compute:

```tsx
const publication = live?.platforms.find((item) => item.platform === platform.platform);
const already = publication ? Object.values(publication.publications).includes(saved.id) : false;
const reason = publishProblem(saved, platform.platform, { connection: platform.state === 'reconnect' ? 'reconnect_required' : 'connected', publication: already ? 'published' : null, dirty });
```

     and render:

```tsx
<button type="button" className="ghost" disabled={Boolean(reason)} title={reason ?? undefined} onClick={() => setSheet(platform.platform)}>Publish to {META_LABEL[platform.platform]}</button>
{reason && !already && <small className="so-publish-why">{reason}</small>}
```

  5. When `sheet` is set, render:

```tsx
<PublishSheet
  post={saved}
  platform={sheet}
  username={connected.find((item) => item.platform === sheet)?.username ?? ''}
  onClose={() => setSheet(null)}
  onPublished={(text) => {
    setSheet(null);
    // The post changed on the server (now published); take its fresh copy the way every other action does.
    void safeAction(loadSocialMonthAction, (message) => ({ success: false, message, posts: [], databaseReady: true, loadError: true }))(saved.period)
      .then((month) => {
        const fresh = month.posts.find((item) => item.id === saved.id);
        if (fresh) accept(fresh, text);
        else setMessage({ text, error: false });
      });
  }}
/>
```

     `accept(next, text)` is the drawer's existing helper: it replaces the saved post, resets the form and shows the message. Import `loadSocialMonthAction` from `@/app/social/actions`.
  6. When the post is published and `live` has stats for it, render under `.so-published-note`: `<PostStatsLine post={saved} live={live} />`.

- [ ] **Step 6: Styles.** Append to `app/styles/atlas-social.css`:

```css
/* Instagram and Threads: month line, stats line, confirm sheet. */
.so-live { margin: 10px 0 4px; display: grid; gap: 6px; }
.so-live-line { margin: 0; font-size: 13px; color: var(--fd-soft); }
.so-live-line strong { color: var(--fd-ink); font-weight: 650; }
.so-outside summary { cursor: pointer; font-size: 12.5px; color: var(--fd-soft); }
.so-outside ul { margin: 6px 0 0; padding-left: 18px; font-size: 12.5px; }
.so-stats { display: block; margin-top: 3px; font-size: 11.5px; color: var(--fd-soft); }
.so-publish-why { display: block; font-size: 11.5px; color: var(--fd-soft); }
.so-sheet { margin-top: 14px; padding: 16px 18px; border-radius: 22px; background: var(--gl-fill); border: var(--gl-edge); box-shadow: var(--gl-shadow); -webkit-backdrop-filter: var(--gl-blur); backdrop-filter: var(--gl-blur); }
.so-sheet h3 { margin: 0; font-size: 16px; }
.so-sheet-who { margin: 4px 0 10px; font-size: 12.5px; color: var(--fd-soft); }
.so-sheet-media { width: 100%; max-height: 260px; object-fit: cover; border-radius: 14px; }
.so-sheet-text { white-space: pre-wrap; font: inherit; font-size: 13.5px; line-height: 1.55; margin: 10px 0; padding: 10px 12px; border-radius: 12px; background: color-mix(in srgb, var(--fd-ink) 5%, transparent); max-height: 220px; overflow: auto; }
.so-sheet-warn { margin: 0 0 8px; font-size: 12.5px; font-weight: 600; color: var(--fd-ink); }
```

- [ ] **Step 7: Verify.** `npx tsc --noEmit && npx eslint components/social app/styles` → clean. `npx vitest run` → all pass. `pnpm build` → exit 0.

- [ ] **Step 8: Commit.**

```bash
git add components/social app/styles/atlas-social.css
git commit -m "Instagram and Threads: stats in the planner and a confirmed Publish button"
```

---

### Task 10: E2E, owner docs, README

**Files:**
- Create: `tests/e2e/social/meta.spec.ts`
- Modify: `docs/phase-1-owner-actions.md`, `README.md`, `BUILD_ROADMAP.md`

- [ ] **Step 1: Write the E2E test.** First read `tests/e2e/support/fixtures.ts` and `tests/e2e/finance/manual-expense.spec.ts`, and follow how they open Social and create a post. Then write `tests/e2e/social/meta.spec.ts`:

```ts
import { expect, openApp, openTab, test } from '../support/fixtures';

const live = (externalId: string, postId: string | null) => ({
  platforms: [{
    platform: 'instagram', username: 'orbis_test', state: 'ok', matchedPostIds: [],
    posts: [{ externalId, caption: 'Shared outside the plan', permalink: 'https://www.instagram.com/p/x/', timestamp: '2026-09-21T04:30:00+0000', productType: 'FEED', thumbnail: null, stats: { reach: 1200, likes: 84, comments: 6, saves: 3 } }],
    publications: postId ? { [externalId]: postId } : {},
  }],
});

test('the month line shows Instagram reach and posts made outside the plan', async ({ page }) => {
  await page.route('**/api/social/live*', (route) => route.fulfill({ json: live('m1', null) }));
  await openApp(page);
  await openTab(page, 'Social');
  await expect(page.getByText('Instagram', { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/1 post · 1\.2K reach/i)).toBeVisible();
  await page.getByText('Posted outside your plan (1)').click();
  await expect(page.getByRole('link', { name: 'Shared outside the plan' })).toBeVisible();
});

test('a reconnect state says so instead of stats', async ({ page }) => {
  await page.route('**/api/social/live*', (route) => route.fulfill({ json: { platforms: [{ platform: 'threads', username: 'x', state: 'reconnect', posts: [], matchedPostIds: [], publications: {} }] } }));
  await openApp(page);
  await openTab(page, 'Social');
  await expect(page.getByText('Reconnect Threads in Settings to see stats.')).toBeVisible();
});
```

Driving the publish button needs a saved, ready post with media in the test account. Add a third test only if the fixtures already offer a way to create a ready post with a PNG. It should assert that the Instagram button is disabled and that the reason text "Instagram only accepts JPEG photos" is visible. If the fixtures don't offer one, record in the ledger that this case is covered by `publish-rules.test.ts` only.

- [ ] **Step 2: Run it.** `npx playwright test tests/e2e/social/meta.spec.ts --reporter=line` → 2 passed. This needs the E2E account setup; if it isn't available, record that the test was written but not run.

- [ ] **Step 3: Owner docs.** Append to `docs/phase-1-owner-actions.md`:

```markdown
## Instagram and Threads (2026-09-30)

1. Reset the App secret and the Threads app secret in the Meta dashboard (the old ones were exposed in a screenshot).
2. Instagram → API setup with Instagram login: add redirect URLs `https://<site>/auth/meta/instagram/callback` and `http://localhost:3000/auth/meta/instagram/callback`; copy the Instagram app ID and secret into `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`.
3. Threads: add redirect URLs `…/auth/meta/threads/callback`; copy into `THREADS_APP_ID` / `THREADS_APP_SECRET`.
4. App roles: add your accounts as Instagram tester and Threads tester, and accept both invites in the apps.
5. Instagram must be a Professional (Creator or Business) account.
6. App settings → Basic: privacy policy `https://<site>/privacy`, data deletion `https://<site>/delete-account`.
7. Apply `supabase/migrations/202609300200_social_meta.sql`, set the four variables in Vercel, deploy, then Settings → Connections → Connect.
```

- [ ] **Step 4: README and roadmap.**
  - In `README.md`, change the Social bullet to: `- **Social:** a month-by-month planner for your own posts; with Instagram and Threads connected, live stats, published posts marked automatically, and publishing when you confirm.`
  - In `BUILD_ROADMAP.md`, under `### 6c. Social planner`, add:
    - `- [x] Instagram and Threads: connect, live stats, auto-mark published, confirmed publish`
    - `- [ ] Apply 202609300200_social_meta.sql and the Meta app setup in docs/phase-1-owner-actions.md`

- [ ] **Step 5: Full verification.** `npx tsc --noEmit && pnpm lint && npx vitest run && pnpm build` → all pass.

- [ ] **Step 6: Commit.**

```bash
git add tests/e2e/social/meta.spec.ts docs/phase-1-owner-actions.md README.md BUILD_ROADMAP.md
git commit -m "Instagram and Threads: end-to-end test and setup docs"
```

---

## After the tasks

- **Manual check with the owner present.**
  1. Apply the migration to the database the owner chooses.
  2. Connect both accounts.
  3. Open Social and check that the stats appear.
  4. Publish one real post to each platform, only after the owner says go.
  5. Watch that the post is marked published with the real link.
- **Record the outcome.** Put the result, including any Meta error text, in the final message.
