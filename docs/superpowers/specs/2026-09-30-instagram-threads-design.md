# Instagram and Threads in the Social planner

Date: 2026-09-30 · Status: draft for review

## Why

The Social tab plans posts month by month, but it knows nothing about what actually went out. Today you:

- mark a post published by hand, typing the platform and the link;
- see no stats for anything you posted;
- copy the caption into the Instagram or Threads app yourself.

Success means, for your own Instagram (Professional) and Threads accounts:

1. **Connect.** Each is connected once from Settings and stays connected: tokens refresh themselves, and there is a clear Reconnect when they can't.
2. **Stats.** Published posts show their live stats in the planner.
3. **Auto-mark.** A planned post that went live, whether from Orbis or from the phone, is marked published with the real date and link, without typing.
4. **Publish.** A ready post can be published from Orbis, only after a confirm step that shows exactly what will go out. Nothing ever posts on its own.

## Decisions made in brainstorming

| Question | Decision |
|---|---|
| Features | Show posts and stats; auto-mark as published; publish from Orbis. Reading comments is out of scope |
| Publishing | Publish now, with confirm. No scheduling or auto-posting |
| Platforms | Instagram and Threads together |
| Approach | Direct integration with Meta's APIs (OAuth per platform, encrypted tokens, live stats). Rejected: a third-party posting service (content and account access through another company, and a cost); a stats-sync job (storage and scheduling nobody asked for) |

## Constraints

- **This is the first write to a connected service.** Every other connection stays read-only. Settings and `/privacy` must say that Instagram and Threads can publish, and only when you confirm.
- **Only your own accounts.** The Meta app stays unpublished (development mode) with you added as an Instagram tester and a Threads tester. No App Review.
- **Instagram needs a Professional (Business or Creator) account.** This is "Instagram API with Instagram Login", so no Facebook Page is needed.
- **Media.** Meta fetches media from a public URL. Orbis gives it a 1-hour signed URL to the private `social-media` object; nothing is made public.
- **Formats.** Instagram image posts accept JPEG only. Threads accepts JPEG and PNG. Both accept MP4 and MOV video. The planner also allows PNG (Instagram), WebP, GIF and WebM; those are blocked with a clear reason, never converted.
- **Secrets.** App IDs and secrets live only in server environment variables and are never logged. The secrets visible in a screenshot during brainstorming must be reset before use.

## Architecture

| Unit | Responsibility | Depends on |
|---|---|---|
| `lib/meta/types.ts` | `MetaPlatform = 'instagram' \| 'threads'`, `LivePost`, `LiveStats`, `Connection`, `PublishRequest`, result types. Client-safe | nothing |
| `lib/meta/config.ts` | Reads `INSTAGRAM_APP_ID/SECRET`, `THREADS_APP_ID/SECRET`; the redirect URI from `lib/site.ts`; `metaConfigured(platform)` | env, `lib/site.ts` |
| `lib/meta/requests.ts` | **Pure** builders for every Meta call (URL, method, body) for both platforms: authorize URL, code exchange, long-lived exchange, refresh, media list with insights, create container, container status, publish, permalink | types |
| `lib/meta/client.ts` | Runs a built request with `fetch` (8 s timeout, `cache: 'no-store'`), parses JSON, and maps Meta error codes to typed errors (`MetaAuthError` for 190/OAuth, `MetaRejectedError` with Meta's message, `MetaUnavailableError`) | requests |
| `lib/meta/connection.ts` | Loads, saves and deletes `social_connections` rows. Encrypts and decrypts tokens with `lib/crypto/credentials.ts`. `usableToken(userId, platform)` refreshes when fewer than 7 days are left, and marks `reconnect_required` on `MetaAuthError` | client, admin Supabase client |
| `lib/meta/match.ts` | **Pure** auto-mark matching (rules below) | types |
| `lib/meta/publish-rules.ts` | **Pure** `publishProblem(post, platform, connection)`: a reason string, or null | types, social types |
| `lib/meta/live.ts` | Server: stats and matches for a month, across connected platforms. Also finishes `processing` publications (see Flow) | connection, client, match, social repository |
| `lib/meta/publish.ts` | Server: claim, create container, check, publish, record | connection, client, publish-rules, social repository |
| `app/auth/meta/[platform]/start/route.ts`, `…/callback/route.ts` | OAuth with the signed-state cookie from `lib/security/oauth-state.ts`, exactly as Zerodha does | connection, config |
| `app/api/social/live/route.ts` | `GET ?period=YYYY-MM` → `SocialLive` for the month | live |
| `app/social/meta-actions.ts` | `startPublishAction(postId, platform)`, `checkPublishAction(publicationId)`, `disconnectMetaAction(platform)` | publish, connection |
| UI | `components/social/live-stats.tsx` (month line, per-post line, "posted outside your plan"); `components/social/publish-sheet.tsx` (confirm); publish buttons in `post-drawer.tsx`; Instagram and Threads rows in `components/settings/app-integrations.tsx` | |

## Data

Migration `202609300200_social_meta.sql`. It is idempotent, like every other migration.

```sql
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

create table if not exists public.social_publications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  post_id uuid not null references public.social_posts (id) on delete cascade,
  platform text not null check (platform in ('instagram', 'threads')),
  status text not null check (status in ('processing', 'published')),
  source text not null check (source in ('orbis', 'matched')),
  container_id text,
  external_id text,
  permalink text check (permalink is null or permalink ~* '^https://'),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, platform),
  constraint social_publications_published_complete
    check (status <> 'published' or (external_id is not null and published_at is not null))
);
```

- **`social_connections` access.** RLS on. `authenticated` gets **no grant at all**; only `service_role` reads and writes. The browser learns connection state (platform, username, status) through server code only, so the encrypted token column is never exposed through the Data API.
- **`social_publications` access.** RLS on. `authenticated` may `select` its own rows; writes are `service_role` only.
- **Triggers.** `set_updated_at` on both tables.
- **The post's own fields.** When a post gets its first publication, it also gets `status = 'published'` and `published_at / published_platform / published_link` from that publication, so every existing reader keeps working. Revision history records `'published'` with the platform, and records `source: 'matched'` when auto-marked.
- **Unmarking.** `markPublishedAction(id, null)` ("Mark as not published") also deletes the post's `social_publications` rows. It never deletes anything on Instagram or Threads, and the drawer says so.
- **Export and deletion.** Add `social_publications` to `EXPORT_TABLES`. `social_connections` is **not** exported, because it holds tokens, like `gmail_connections`. Both cascade on account deletion.
- **Rate limit.** Publishing uses the existing `consume_rate_limit` function (`202609280201_rate_limits.sql`) with bucket `social_publish_instagram` or `social_publish_threads` (bucket names must match `^[a-z_]{2,30}$`), 10 per day.

## Meta API mapping (verified against Meta's docs on 2026-09-30)

| Step | Instagram (`graph.instagram.com`, pinned `v25.0`) | Threads (`graph.threads.com`, pinned `v1.0`) |
|---|---|---|
| Authorize | `https://www.instagram.com/oauth/authorize` with `client_id, redirect_uri, response_type=code, scope, state` and scopes `instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights` | `https://threads.com/oauth/authorize` with the same params and scopes `threads_basic,threads_content_publish,threads_manage_insights` |
| Code → short token | `POST https://api.instagram.com/oauth/access_token` (form: `client_id, client_secret, grant_type=authorization_code, redirect_uri, code`) | `POST https://graph.threads.com/oauth/access_token` (same form) |
| Short → 60-day token | `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret&access_token` | `GET https://graph.threads.com/access_token?grant_type=th_exchange_token&client_secret&access_token` |
| Refresh (token ≥ 24 h old, unexpired) | `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token` | `GET https://graph.threads.com/refresh_access_token?grant_type=th_refresh_token&access_token` |
| Me | `GET /me?fields=user_id,username`, where **`user_id`** is the account ID used below | `GET /me?fields=id,username` |
| Month's posts | `GET /{user_id}/media?fields=id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url&since&until&limit=50` | `GET /{id}/threads?fields=id,text,media_type,permalink,timestamp&since&until&limit=50` |
| Stats | `GET /{media}/insights?metric=…`: `FEED`/`REELS`: `reach,views,likes,comments,saved,shares`; `STORY`: `reach,views,shares,replies` | `GET /{media}/insights?metric=views,likes,replies,reposts,quotes,shares` |
| Create container | `POST /{user_id}/media`: photo `image_url, caption`; video post or reel `media_type=REELS, video_url, caption, share_to_feed=true`; story `media_type=STORIES` with `image_url` or `video_url` | `POST /{id}/threads`: `media_type` `TEXT` / `IMAGE` / `VIDEO`, `text`, `image_url` / `video_url` |
| Container status | `GET /{container}?fields=status_code` (`FINISHED`, `IN_PROGRESS`, `ERROR`, `EXPIRED`, `PUBLISHED`) | `GET /{container}?fields=status,error_message` (same values) |
| Publish | `POST /{user_id}/media_publish?creation_id=` | `POST /{id}/threads_publish?creation_id=` (Meta suggests about 30 s after creating; Orbis waits for `FINISHED`) |
| Permalink | `GET /{media}?fields=permalink,timestamp` | `GET /{media}?fields=permalink,timestamp` |

Notes from verification:

- **Strip the code suffix.** The authorization code arrives with a trailing `#_`, which must be removed before exchanging it.
- **Token response shape.** Instagram's short-token response may be flat, or wrapped as `{ data: [ … ] }`. Parse both.
- **Account IDs.** Account IDs in token responses are JSON numbers above 2^53. Never take them from there; take them from `/me`, where they are strings.
- **Stats must match the post type.** Asking Instagram for a metric that doesn't apply to a media's `media_product_type` fails the whole insights call. The metric set is therefore chosen per type. If a media's stats call still fails, only that post shows no stats.
- **Instagram video.** A single video goes out as `REELS` with `share_to_feed=true`. There is no plain `VIDEO` post type.
- **Media format limits.** Instagram images must be JPEG. Threads images may be JPEG or PNG, up to 8 MB.
- **Time range.** `since` / `until` are sent as Unix seconds.
- **Hosts.** Threads is reachable on `graph.threads.com` or `graph.threads.net`. The host is one constant.
- **Publishing limits.** Meta's own limits are 50–100 a day on Instagram and 250 on Threads. Orbis's cap of 10 a day sits well under both.
- **Errors.**
  - Meta error `9004` (subcode `2207052`) means Meta could not fetch the media URL.
  - `9007` means the container is not ready yet.
  - `190` means the token is invalid.

## Publish rules (`publishProblem`)

The checks run in this order. The first failure is the reason shown.

1. The platform is not connected, or needs reconnecting → "Connect Instagram in Settings first." / "Reconnect Instagram in Settings."
2. The post is not saved, or is neither `ready` nor `published` → "Save the post and mark it ready first." `published` is allowed so a post already out on one platform can go to the other.
3. The post does not list this platform → "Add Instagram to this post's platforms first."
4. A publication already exists for this post and platform → "Already published on Instagram." / "Publishing on Instagram is in progress."
5. Format against media:

   | Format and media | Instagram | Threads |
   |---|---|---|
   | post + image | JPEG only | JPEG or PNG |
   | post + video, reel | MP4 or MOV → `REELS` | MP4 or MOV → `VIDEO` |
   | story | image (JPEG) or video → `STORIES` | "Threads has no Stories." |
   | no media | "Instagram needs a photo or video." | `TEXT` |
   | WebP, GIF or WebM | "Instagram doesn't accept .webp — use a JPEG." | same wording |

6. Text length. The text sent is the caption, then a blank line, then the hashtags as `#tag`, joined by spaces; it is the same text the confirm sheet shows. It must be at most 2,200 characters on Instagram and 500 on Threads, with at most 30 hashtags on Instagram.

The rules run in the drawer, to disable the button with the reason, and again in `startPublishAction`.

## Flows

**Connect.** Settings → Connections → Instagram → Connect.

1. `/auth/meta/instagram/start` checks `requireUser` and `metaConfigured`, signs the state (purpose `instagram` or `threads`), sets an httpOnly cookie scoped to `/auth/meta/<platform>`, and redirects to Meta.
2. The callback verifies the state, exchanges the code, exchanges again for the 60-day token, and reads `/me`.
3. It upserts `social_connections`.
4. It redirects to `/?tab=settings&meta=<platform>-connected`, or to a reason: `-cancelled`, `-failed` or `-not-configured`. The `?meta=` value is shown as a notice in Settings, the same way `?gmail=` is.

**Disconnect.** Deletes the row. Meta's own permission can be removed in the Instagram or Threads app; the Settings copy says so.

**Stats and auto-mark.** Opening Social, or changing month, sends `GET /api/social/live?period=`, in parallel with the month's posts. For each connected platform `live.ts`:

1. finishes any `processing` publications of this user (the same routine as `checkPublishAction`);
2. fetches the month's posts and their stats;
3. runs `match.ts` against the month's planned posts, and records each match: a `matched` publication, the post set to published, and history;
4. returns:

```ts
type SocialLive = {
  platforms: Array<{
    platform: MetaPlatform;
    username: string;
    state: 'ok' | 'reconnect' | 'unavailable';
    posts: LivePost[];        // with stats
    matchedPostIds: string[]; // newly marked this call
  }>;
};
```

`components/social/live-stats.tsx` shows three things:

- **A month line** per platform: "Instagram · 9 posts · 14.3k reach".
- **A stats line** under each published post in the list and calendar, from the `LivePost` whose `external_id` matches its publication.
- **"Posted outside your plan (n)"**, collapsed, with links.

A notice says "Marked 2 posts as published from Instagram." when `matchedPostIds` is non-empty. On `unavailable` the planner renders as today with "Stats unavailable right now".

**Matching rules (`match.ts`).**

- **Normalising a caption:** lowercase; remove `#hashtags`, emoji (`\p{Extended_Pictographic}`) and URLs; collapse whitespace; trim.
- **A candidate planned post:**
  - lists the platform;
  - has status `ready` or `published`;
  - has no publication on that platform yet.
- **A live post matches a candidate when:**
  - it was posted within ±3 days of `plannedFor`, or inside `period` when the post has no day; and
  - the normalised live caption starts with the first 80 characters of the normalised planned caption, or equals it when the planned caption is shorter than 80.
  - A normalised planned caption under 12 characters never matches, because it is too weak to identify a post.
- **Only one-to-one pairs are recorded.** A live post that fits two candidates, or a candidate that fits two live posts, records nothing.

**Publish.**

1. The drawer's **Publish to Instagram** opens `publish-sheet.tsx`. It shows the media preview, `@username`, the format, the exact text, and "This posts publicly on Instagram right now. Orbis can't delete it afterwards." Only its **Publish** button calls `startPublishAction(postId, 'instagram')`.
2. `startPublishAction` (`requireUser`, app lock, `isUuid`):
   1. loads the post as its owner;
   2. runs `publishProblem`, and returns its reason if any;
   3. takes a rate-limit token;
   4. **claims** by inserting a `processing` publication; the unique key refuses a second one;
   5. signs a media URL valid for 1 hour;
   6. creates the container and stores `container_id`;
   7. checks the status once and publishes if `FINISHED`.

   It returns `{ state: 'published', permalink }` or `{ state: 'processing', publicationId }`.
3. On `processing`, the sheet shows "Publishing… Meta is processing the video" and calls `checkPublishAction(publicationId)` every 5 s for up to 5 minutes. Each call checks the status; on `FINISHED` it publishes, reads the permalink, and records it.
4. **Recording** a publication:
   - the publication becomes `published`, with `external_id`, `permalink` and `published_at`;
   - if the post was not yet published, its `status` and `published_*` fields are set;
   - a history entry is added.
5. On `ERROR` or `EXPIRED`, or when Meta rejects the container or the publish, the claim is deleted so a retry is possible, and Meta's message is returned in plain words.
6. Leaving mid-way is safe. The next `/api/social/live` call finishes any `processing` rows. A row older than 24 hours is deleted, with the message "Publishing didn't finish; try again."

## Settings and copy

- **Connections** gains Instagram and Threads rows. Each shows `@username`, a badge **"Can publish, only when you confirm"** (other rows keep **Read-only**), the status, and Connect / Reconnect / Disconnect. When the platform's environment variables are missing, the row reads "Not set up on the server".
- **The Connections note** becomes: "Everything Orbis reads from is read-only. Instagram and Threads can also publish a post, only when you press Publish and confirm."
- **`/privacy`** gains a section explaining:
  - what Orbis reads from Instagram and Threads (your posts, captions and stats);
  - what it sends (only posts you confirm, with a temporary link to that one file);
  - where tokens live (encrypted, server-only);
  - how to disconnect.

## Owner setup (added to `docs/phase-1-owner-actions.md`)

1. **Reset the App secret and the Threads app secret** in the Meta dashboard; the old ones were exposed in a screenshot.
2. **Instagram → API setup with Instagram login.** Add the redirect URLs `https://<site>/auth/meta/instagram/callback` and `http://localhost:3000/auth/meta/instagram/callback`. Copy the Instagram app ID and secret into `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`.
3. **Threads.** Add the redirect URLs `…/auth/meta/threads/callback`. Copy into `THREADS_APP_ID` / `THREADS_APP_SECRET`.
4. **App roles.** Add your accounts as an Instagram tester and a Threads tester, then accept the invites (Instagram: Settings → Apps and websites → Tester invites; Threads: account settings → Website permissions → Invites).
5. **Switch Instagram to a Professional account** if it isn't one.
6. **Replace the placeholder URLs** in the app's basic settings: privacy policy `https://<site>/privacy`, data deletion `https://<site>/delete-account`.
7. **Apply `202609300200_social_meta.sql`**, and set the environment variables in Vercel.

## Errors

| Case | Behaviour |
|---|---|
| Token expired or revoked (Meta error 190) | The connection is marked `reconnect_required`. Stats show "Reconnect Instagram to see stats", and publish is disabled with the same reason |
| Meta slow or down (8 s timeout, 5xx) | `state: 'unavailable'`; the planner renders unchanged |
| A metric rejected by Meta | Dropped from the next request for that platform; other metrics still show |
| Publish rejected | Claim removed; Meta's message shown; post stays `ready` |
| Video still processing after 5 minutes | "Still processing; Orbis will finish it next time Social opens" |
| Environment variables missing | Row shows "Not set up on the server"; start route redirects with `-not-configured` |
| Migration not applied | The live route returns no platforms; Connections rows show "Not set up yet"; the planner works as today |

Unexpected errors go to `console.error` with no token or secret in the message. The user sees typed copy.

## Testing

- **Unit tests (vitest):**
  - `match.test.ts`:
    - exact match and 80-character prefix match;
    - hashtags, emoji and URLs ignored;
    - short captions never match;
    - the ±3-day window and the in-month window with no day;
    - ambiguity in both directions records nothing;
    - an already-published platform is skipped.
  - `publish-rules.test.ts`: every cell of the format table, JPEG-only on Instagram, PNG allowed on Threads, WebP/GIF/WebM blocked, the 2,200/500/30 limits at their edges, not ready, not saved, platform not listed, existing or processing publication, not connected or reconnect.
  - `requests.test.ts`: the authorize URL (scopes, state, redirect), each exchange and refresh, the media-list fields and date range, container bodies per format, publish and status — for both platforms. The secret appears only in the server-side exchange bodies.
  - `connection.test.ts` for a pure `needsRefresh(expiresAt, now)`: under 7 days refreshes, over 7 days doesn't.
- **E2E (Playwright):** `/api/social/live` is mocked with `page.route`; the actions run against the real server, where a PNG post fails the rules before any Meta call.
  - a published post shows its stats line;
  - the month line shows;
  - a PNG post's Instagram button is disabled with the JPEG reason;
  - the confirm sheet shows the exact caption and hashtags text.
- **Manual, with the owner present:** connect both accounts, see stats, and publish one real post to each platform. It is public, so it runs only when the owner says go.

## Out of scope

- Reading or replying to comments; DMs; carousels; scheduled or automatic posting.
- Deleting or editing posts on Instagram or Threads.
- Importing posts made outside the plan as planned posts. They are listed only.
- Stats history, trends, or feeding stats to heads-ups.
- Facebook Pages, LinkedIn, X, YouTube and TikTok.
- App Review, or accounts other than the owner's.
