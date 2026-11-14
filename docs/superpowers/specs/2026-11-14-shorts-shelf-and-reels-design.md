# Shorts on autopilot: the shelf, and Reels for a stories account

Date: 2026-11-14 · Status: **draft, for the owner's approval** · Builds on `2026-11-10-faceless-shorts-foundation-design.md`, `2026-11-13-youtube-publishing-design.md` and the autopilot (commit 1a63b48).

## Why

The owner wants the story channels to run without being watched: the home PC makes videos overnight, Orbis posts them by itself at the owner's times, several a day, on YouTube and on a separate Instagram account. The owner steps in only when something breaks.

Today a hiccup costs a day. The autopilot starts one short a day after 09:00. If the PC is off, the build fails or the Google connection drops, that day has nothing to post: `last_run_on` has already moved on, so a failed build is never replaced, and nothing tells the owner.

**Orbis has never posted to Instagram.** `publishSocialPost` in `lib/social/meta.ts` exists but nothing calls it, and the existing `instagram` connection is read only by insights. Part 2 is therefore the first real Instagram post, and its plan starts with a live end-to-end test.

## Goals

- **A shelf of finished videos per platform**, a few days deep, so the PC being off for a night or a build failing never shows on the channel.
- **Several posts a day** on each platform, following that platform's post times.
- **Builds only in a night window** the owner sets, so the PC is free in the day.
- **Failed autopilot builds are replaced automatically**, within a daily cap that protects Claude usage.
- **Reels on a separate Instagram account** ("the stories account"), with **different stories** from YouTube, posted on its own schedule.
- **One health card** that says whether the whole chain is working.
- Two fixes that belong here: a clearer Google reconnect message, and no double post on a manual YouTube Retry.

## Non-goals (later parts, designed separately)

- Phone alerts when the chain breaks (part 3 in the order agreed on 2026-11-14 is Growth insights, then alerts).
- Growth insights: views, retention, trends, feeding winners back into topics.
- AI suggestions for the owner's **personal** Instagram posts. The owner said on 2026-11-13 not to suggest those yet; nothing here touches the personal account's composer.
- Cross-posting the same video to both platforms. The owner wants different stories on each.

## Anti-goals (failure even if it "works")

- **Posting twice**, on either platform.
- **Burning the owner's Claude usage**: a loop of failing builds, or filling a big shelf in one night.
- **Breaking the YouTube posting that works today.** It has leases, resumable uploads, quota holds and import paths, all tested; part 2 must not rewrite it.
- **Posting a story to the personal Instagram account.** Only the stories account ever gets autopilot Reels.

## Decisions made with the owner (2026-11-14)

- Build all of it, smallest parts first. Order: **1 Shelf**, **2 Reels**, **3 Growth insights**, **4 Phone alerts**. This document covers parts 1 and 2.
- **No review step.** "If I don't see them it's also not an issue." The shelf already gives days in which the owner *can* delete a queued video; nothing waits for approval. (The earlier idea of a 12-hour review window is dropped.)
- **Several posts a day**, using the YouTube schedule's existing post times (up to 6).
- **Build at night.**
- **Reels get different stories** from YouTube, on a **separate Instagram account**.

## Approaches considered

**Who decides what to build next**
- *The PC's autopilot looks at the shelves (chosen).* It already runs a once-a-minute check and is the only thing that can build. One moving part.
- *The cloud decides and queues jobs for the PC.* Rejected: nothing gets built without the PC anyway, so it adds a second scheduler for no gain.

**How Reels are posted**
- **A. A separate Instagram queue, schedule and posting route, shaped like YouTube's (chosen).** YouTube's code stays untouched. The pure schedule maths (`lib/youtube/schedule.ts`: `isDue`, `nextSlot`, `slotMinutes`) has no YouTube in it and is reused as it is. Cost: some code looks like YouTube's.
- B. Turn `youtube_queue` into one queue for every platform. Rejected: it rewrites the YouTube posting built on 2026-11-13, and every protection in it (leases, resume, quota hold, the import script) would need re-proving.
- C. Copy each YouTube video to Instagram. Rejected: the owner wants different stories.

## Part 1: the shelf

### What the shelf is

For each platform the autopilot feeds (a *destination*: `youtube`, later `instagram`):

- **Posts per day** = the number of post times in that platform's schedule (`youtube_settings.post_times`, 1–6). Days of the week are ignored here; the result is slightly generous on a schedule with days off, which is the safe side.
- **Target** = `shelf_days × posts per day`. `shelf_days` is a new autopilot setting, 1–7, default **3**.
- **On the shelf** = rows in that platform's queue that will still post (`queued` or `uploading` for YouTube) **plus** autopilot jobs for that destination still being made (`queued`, `planning`, `plan_ready`, `building`). Counting jobs in progress stops the PC from starting five builds for one gap.
- **Shelf in days** (for the screen) = on the shelf ÷ posts per day.

A destination is **left out** while its platform can't post: not connected, connection needs reconnecting, or its posting tables aren't migrated. A **paused** schedule still counts. Pausing posting doesn't mean "stop making"; the shelf just stops growing once it is full.

Manual shorts the owner queues by hand count too, because they sit in the same queue. That is correct: they will post.

### When the PC starts a video

Once a minute (the existing `AUTOPILOT_CHECK_MS` loop in `workers/shorts-studio/src/main.ts`), the worker:

1. Reads the autopilot row. Off: nothing.
2. **One at a time.** If any autopilot job is still in progress (`queued`, `planning`, `plan_ready`, `building`), it starts nothing. So the autopilot never queues a burst; it adds the next video only when the last one is finished or has failed. A short the owner queues by hand therefore waits behind at most one autopilot job. *(Builder-check call: without this, the once-a-minute check could add about 9 jobs in the window's first minutes, and the worker would build them on into the day.)*
3. **Build window.** The current time on the owner's clock must be inside `[window_start, window_end)`. A window that crosses midnight (23:00–07:00) is normal. The existing `start_time` column becomes `window_start`; a new `window_end` is added. Default **23:00–07:00**, **including the owner's existing row**: the owner asked for night building, so the migration sets it rather than keeping 09:00. The worker also **won't take an autopilot job outside the window**. A job that is mid-build when the window closes finishes; one still waiting stays queued until the next night. Manual jobs are taken at any time.
4. **Daily cap.** At most `total posts per day across destinations + 1` autopilot videos *started* per local day. The +1 replaces one failure without letting a broken build loop. The local day is the owner's calendar day. A window that crosses midnight spans two days, so the cap allows up to two days' worth in one night. That is intended: it is what lets a short shelf catch up.
5. **Pick the destination** whose shelf is lowest in days and below target, among those switched on in **Post to** (stored in a new `destinations text[]` column; default `{youtube}`; Instagram is added only when the owner switches it on). Tie: YouTube. None below target: nothing. Switching a destination off stops building for it; its shelf still posts.
6. Start **one** short: a fresh topic (below), the destination recorded in the job's options (`options.destination`), plan auto-approved as today.

Starting is guarded so two workers or a restart can't double-start: one conditional update moves the day's counter (`started_on`, `started_count`) forward, and only the caller whose update matched inserts the job. This replaces today's `last_run_on` guard, which allowed one a day. `last_run_on` stays in the table, unused, so an older worker still running reads a sensible row.

### Failed builds

They need no extra code. A failed autopilot job leaves the shelf, so the next minute's check starts a replacement with a new topic, inside the window and under the cap. "Claude Code needs attention" (signed out or out of usage) already pauses the worker for 30 minutes; the shelf waits with it.

### Topics

`pickStoryTopic` already avoids topics used in the owner's last 150 jobs of the style, across all destinations, so YouTube and Instagram never get the same story. 16 animals × 12 stories = 192 pairs. At 4 a day that is about 48 days before a pair comes back. Widening the list is part 3's job (Growth insights).

### When a video finishes

The worker routes it by `options.destination`: `youtube` → `queueForYouTube` (as today); `instagram` → `queueForInstagram` (part 2). A job with no destination (made before this change) goes to YouTube, as today.

### The Autopilot card

It gains three things:
- **Build window**: from / to.
- **Keep ready**: 1–7 days.
- **Post to**: a YouTube switch and, after part 2, an Instagram switch. Each is greyed out with the reason when that platform can't post.

The 30-a-month limit doesn't apply to autopilot shorts. That stays as it is.

The new autopilot columns are `window_end`, `shelf_days`, `destinations`, `started_on` and `started_count`.

### The health card

At the top of Social → Shorts, one card, read on the server from tables that already exist:

```
Shelf      YouTube 5 · about 2½ days     Instagram 4 · about 2 days
Next post  YouTube today 7:00 pm         Instagram today 8:30 pm
PC         Online · building "baby owl who…"      (or: Offline since 06:12)
Accounts   YouTube connected · Instagram stories connected
Problems   None in the last 24 h          (or: 1 build failed · YouTube daily limit hit)
```

- *Next post* is `nextSlot`. *PC* is the existing worker presence.
- *Problems* lists, for the last 24 hours: failed autopilot builds, failed queue rows, a quota hold, and any connection needing reconnecting. Each line links to where it is fixed.
- A line in amber when a shelf is under one day.
- The Instagram half appears once part 2 is in.

### The Google reconnect message

When Google refuses the refresh token (`invalid_grant`), the YouTube panel and Settings → Connections say:

> Google ended Orbis's access, so YouTube needs connecting again. If this keeps happening about a week after each connect, your Google app is in Testing: publish it in Google Cloud → Google Auth Platform → Audience.

The same goes for Gmail with its own name. To support the "about a week" judgement later, `social_connections` (YouTube) and `gmail_connections` keep the time of the last successful connect (new column `connected_at`, set on save). The owner-actions doc gains a line: "Publishing status must be **In production**." The 2026-11-13 spec records the project as already *In production*; if that is true, the 7-day cause is ruled out and the disconnects need more evidence. `connected_at` and `updated_at` at the moment of `reconnect_required` give that evidence.

### No double post on a manual YouTube Retry

Today, when a row fails on its last attempt, `countError` clears `upload_url` (`lib/youtube/publish.ts`), and `retryFailed` clears it again (`lib/youtube/repository.ts`). If YouTube had in fact finished the upload and only the final answer was lost, Retry opens a new session and posts the video a second time.

The fix settles the question **at the moment of Retry**, so the queue's rules stay as they are (a queued row never holds a session; the uploading path in `publish.ts` is untouched):
- A row that fails while it has a session **keeps** `upload_url` (status `failed`).
- **Retry first asks that session what it has** (`bytes */total`, with a freshly minted access token), before changing the row:
  - **200/201:** the video is already on YouTube. The row is marked published with that id, and the owner sees "It had already posted."
  - **308, 404/410, or no answer:** the upload didn't finish. The session is cleared and the row goes to the front of the queue to wait for its slot, exactly as Retry does today.
- A failed row **without** a session retries exactly as today.
- *(Builder-check call: putting the row back as `uploading` would post it within 10 minutes even while paused, and would break a tested rule of the queue.)*

## Part 2: Reels on the stories account

### Connecting the stories account

- A second Instagram connection, stored as a new `social_connections.platform` value **`instagram_stories`**. The table's key is `(user_id, platform)`, so the personal `instagram` row is untouched. The platform check constraint gains the value.
- It uses the **same Instagram Login app and the same callback URL** as the personal account. The start route takes `?account=stories`, carried in the signed state cookie, so no new redirect URI has to be added in Meta's dashboard. The callback saves to `instagram_stories` when the state says so.
- Instagram's login page signs in whichever account is active in that browser. The connect button says so: "Switch to your stories account in Instagram first."
- The callback **refuses** a stories connect whose account id matches the existing `instagram` row, whichever account that is ("That account is already connected as your main Instagram. Switch to the stories account and connect again."), and the reverse for the main connect. This keeps autopilot Reels off any account other than the stories one.
- Professional (Creator or Business) only, as today's code already enforces.
- Connect / Reconnect / Disconnect for it live in the Instagram panel (below) and in Settings → Connections as "Instagram (stories)".

### Keeping the token alive

Instagram long-lived tokens last 60 days, and Orbis has no refresh today, so every Instagram connection silently expires. Each run of the Instagram cron route first refreshes **every** `instagram` and `instagram_stories` row (any user) whose token is **older than 24 hours and expires within 20 days**, using `GET graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token`, and saves the new token and `expires_at`. Rows are refreshed whether or not they have anything queued, so the main account's insights stop expiring too. A refused refresh marks the row `reconnect_required`.

### Schedule and queue

Two tables, shaped like YouTube's (one migration):

- **`instagram_settings`**: `user_id` (key), `post_times time[]` (1–6, default `{20:30}`), `days smallint[]`, `timezone`, `paused`, `hold_until`. The Schedule type and `lib/youtube/schedule.ts` are reused unchanged.
- **`instagram_queue`**: `id`, `user_id`, `job_id` (unique while live, as YouTube's), `video_path`, `cover_path`, `caption` (≤ 2,200 characters, ≤ 30 hashtags), `position`, `status` (`queued`, `publishing`, `published`, `failed`, `removed`), `container_id`, `container_at`, `lease_until`, `media_id`, `permalink`, `published_at`, `posted_by` (`schedule` / `manual`), `error`, `attempts`. Row-level security as YouTube's: the owner reads their own rows, and only the service role writes.
- A `instagram_take_row` lease function like `youtube_take_row`.

The caption is the delivery's caption plus its hashtags, trimmed to Instagram's limits.

### Posting (`POST /api/social/instagram/publish`, pg_cron every 10 minutes)

Instagram makes a video post in two steps, and processing a video can take minutes, so one row moves across several runs. A run handles at most one row per person:

1. **Due?** `isDue(schedule, now, postedToday)` as YouTube, or a manual "Post now".
2. **Take the row** with a lease.
3. **No container yet:** create one: `media_type=REELS`, `video_url` = a signed URL to the video in the `shorts` bucket (valid 24 hours), `cover_url` when there is a cover, `caption`, `share_to_feed=true`. Save `container_id` and `container_at`. Status `publishing`. Stop for this run.
4. **Container exists:** read its `status_code`:
   - `IN_PROGRESS`: wait for the next run.
   - `FINISHED`: call `media_publish`. Save `media_id` and `permalink`; status `published`.
   - **`PUBLISHED`: the publish already happened and its answer was lost.** Mark the row published and **never call `media_publish` again.** This is the double-post guard.
   - `ERROR` or `EXPIRED` (containers live 24 hours): clear the container, count an attempt, and make a new one on the next run.
5. **Limits:** before creating a container, read `content_publishing_limit`. At the limit: `hold_until` = the start of the next local day, as YouTube's quota hold.
6. **Attempts:** the same `MAX_ATTEMPTS` rule as YouTube. A failed row keeps its `container_id`, so a manual Retry checks the container's status first and can't post twice.

The unused `publishSocialPost` (with its 8-second wait) is left alone. This route has its own two-step code.

**First step of part 2's plan:** one manual "Post now" of a real short to the stories account, end to end, before the queue and schedule are built. Two things decide whether that works: the Meta app's mode (in development mode the stories account must be added as a tester) and whether `instagram_business_content_publish` is granted.

### Autopilot routing

`queueForInstagram(job, delivery)` in `workers/shorts-studio/src/autopilot.ts`, next to `queueForYouTube`, adds the finished video to `instagram_queue` at the end. It answers `already` on the unique-index conflict, as YouTube's does.

### The Instagram panel (Social → Shorts)

A sibling of the YouTube panel, built from the same parts:
- the stories account's connect state;
- the schedule: post times, days, pause;
- the queue: move, remove, retry, post now;
- recently posted, with permalinks.

A finished short also gets **Add to Instagram** beside **Add to YouTube**, for shorts made by hand.

## Owner steps (written up in `docs/ops/shorts-autopilot-owner-actions.md` at the end)

1. Apply the new migrations in Supabase. Part 1: the autopilot columns and `connected_at`. Part 2: the Instagram tables and the platform value.
2. Run `supabase/cron/instagram_schedule.sql` (part 2).
3. Make the stories account Professional. If the Meta app is still in development mode, add the stories account as an Instagram tester in the Meta dashboard, then accept the invite in that account's Instagram settings.
4. Connect the stories account (switch to it in Instagram first).
5. Set post times for each platform, the build window and "Keep ready" days.
6. Keep the home Linux PC awake in the window (for example, set suspend to "never" in its power settings).
7. Check Google Cloud: the publishing status should be *In production*.

## Testing

- **Pure functions, with unit tests:** shelf counting, target, destination choice, window (including one that crosses midnight), daily cap, health-card summary, Instagram container-status decisions, token-refresh timing, caption trimming.
- **SQL:** the new migrations and lease functions in the existing SQL harness (`lib/youtube/sql-harness.ts` pattern), including the start guard under two racing callers.
- **The worker:** flow tests with `fake-claude.mjs`: a failed autopilot build is replaced; the cap stops a loop of failures; only one autopilot job is in progress at a time; outside the window nothing starts and no autopilot job is taken (manual jobs still are); routing goes by destination.
- **The posting route,** with faked Meta answers: `IN_PROGRESS`→`FINISHED`→published across runs; a lost publish answer (`PUBLISHED` status) never publishes twice; `EXPIRED` makes a new container; limit reached → hold.
- **The YouTube Retry fix:** a failed row with a session, whose session answers 201, becomes published without a second upload; one whose session answers 308 or 404 goes back to the queue without its session.

## Left to the builder

- Exact component structure and copy, within the sketches above and the app's existing panel patterns.
- Whether the Instagram panel and the YouTube panel share a wrapper component.
- Index choices and the exact SQL of the start guard, as long as two racing callers can't both start.
- How the health card's queries are batched.
