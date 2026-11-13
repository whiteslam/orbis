# Faceless Shorts in Social: YouTube Publishing

Date: 2026-11-13 · Status: **approved by the owner 2026-11-13** · Scope: sub-project 3 of 4 (see `2026-11-10-faceless-shorts-foundation-design.md`).

## Why

Finished shorts land in the `shorts` bucket, but getting them onto YouTube still means a terminal on the PC. On 2026-11-13 a stopgap went live on the owner's PC: `~/faceless-shorts/publisher/yt.py` plus a systemd user timer that posts one queued short a day at 18:00. It only runs while the PC is awake, and the queue can only be changed from a terminal.

This moves publishing into Orbis. The owner makes shorts on the PC (often started from the phone), then queues, edits, reorders and posts them from the phone. Uploads run on Orbis's server, so **the PC only has to be on while shorts are being made**.

## Decisions

- **Orbis replaces the PC publisher.** One queue, one scheduler. The PC timer is switched off only after the Orbis queue holds the imported shorts and YouTube is connected, so no day is skipped and nothing posts twice. `yt.py` stays on disk as a fallback.
- **The server uploads.** A pg_cron call to an Orbis route streams the MP4 from the `shorts` bucket to YouTube. No YouTube token or encryption key lives on the PC.
- **One click, editable.** A finished short joins the queue only when the owner taps **Add to YouTube** and confirms the pre-filled details. Nothing posts unseen.
- **Same Google Cloud project and web client as Gmail** (project `orbis-512912`, publishing status *In production*). YouTube is a **separate connection** with its own token and scopes, so disconnecting one never breaks the other.

## Architecture

```
Phone / browser: Social → Shorts               Supabase                                 Google
 Library ─ Add to YouTube ─► queueForYouTube ─► youtube_queue
 YouTube panel ◄── status, queue, posted ─────  youtube_settings, youtube_presets
 Settings → Connections ─ Connect ─► /auth/youtube/start ──────────────────────────────► consent
                         /auth/youtube/callback ◄── code ─────────────────────────────── (youtube.upload,
                           └─► social_connections (platform 'youtube', refresh token)      youtube.readonly)
 pg_cron every 10 min ─► POST /api/social/youtube/publish (CRON_SECRET)
                           ├─ due? (settings, today's post not out)
                           ├─ mint access token from refresh token ─────────────────────► oauth2 token
                           └─ resumable upload, 8 MB chunks ◄─ signed read of `shorts` ──► videos.insert
```

## Connecting YouTube

- **Settings → Connections** gains a **YouTube** row (Connect / Reconnect / Disconnect), beside Instagram and Threads.
- `/auth/youtube/start` sends the user to Google with scopes `https://www.googleapis.com/auth/youtube.upload` and `https://www.googleapis.com/auth/youtube.readonly`, `access_type=offline`, `prompt=consent`, and a signed state bound to the user (same `signState` pattern as the Meta and Gmail flows).
  - It uses `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. The redirect URI is `<site>/auth/youtube/callback`; the owner has added it to the web client in Google Cloud.
  - Like the Meta start route, it refuses a non-HTTPS site URL with a notice rather than a failed round trip.
- `/auth/youtube/callback` checks the state, exchanges the code, calls `channels.list?mine=true` for the channel id and title, and upserts the connection row. No channel on the account: notice `youtube-no-channel`, nothing stored.
- Disconnect revokes the token at Google (best effort) and deletes the row.

## Data (one migration)

- **`social_connections`**
  - `platform` check gains `'youtube'`.
  - New nullable `refresh_token_encrypted text` (AES-256-GCM via `encryptCredential`, like every stored credential).
  - For YouTube: `account_id` = channel id, `username` = channel title (trimmed to 64), `access_token_encrypted` = the latest access token, `expires_at` = null (the refresh token doesn't expire on a schedule).
- **`youtube_settings`**: `user_id` (pk), `post_time` time (default 18:00), `days` smallint[] (ISO 1–7, default all), `timezone` text (default `Asia/Kolkata`), `paused` boolean (default false), `updated_at`.
- **`youtube_presets`**: `user_id`, `style` (pk together), `privacy` (`public` | `unlisted` | `private`), `category_id` text, `made_for_kids` boolean, `tags` text[].
  - Seeded on first read for the 7 styles: Tall Tale → `23` Comedy; Cozy Tales → `1` Film & Animation; Deep Dive, Inside Out, Paper Atlas → `27` Education; Night File, Stick Story → `24` Entertainment. Default privacy `public`, made-for-kids `false`.
- **`youtube_queue`**
  - Identity: `id`, `user_id`, `job_id` (nullable fk to `shorts_jobs`, `on delete set null`), `video_path` (in `shorts`), `cover_path` (nullable).
  - Details: `title` (1–100), `description` (≤5000), `tags` text[] (joined length ≤500), `category_id`, `privacy`, `made_for_kids`.
  - Order and state: `position` integer, `status` (`queued` | `uploading` | `published` | `failed` | `removed`).
  - Upload progress: `upload_url` (the resumable session), `bytes_sent` bigint, `upload_started_at`.
  - Result: `youtube_id`, `published_privacy` (what YouTube actually set), `published_at`, `posted_by` (`schedule` | `manual`), `error` (≤500), `attempts` smallint.
- **RLS** on the three new tables: the owner reads and writes their own rows through server actions; the publish route uses the service role.
- **Schedule:** a new `supabase/cron/youtube_schedule.sql` (same shape as `headsups_schedule.sql`) registers a pg_cron job every 10 minutes that calls the publish route with the `CRON_SECRET` bearer via `net.http_post`. Like the other schedule files, the owner runs it once in the SQL editor; it is not a migration.

## Queueing (Social → Shorts)

- **Library:** each `done` short gets **Add to YouTube**. A sheet opens pre-filled:
  - title ← `delivery.title` (trimmed to 100);
  - description ← `delivery.caption`, a blank line, the hashtags, and `#shorts` appended if missing;
  - tags ← hashtags without `#`, plus the style preset's tags, de-duplicated, trimmed to the 500-character limit;
  - privacy, category, made-for-kids ← the style preset.
  - **Save to queue** appends it (`position` = max + 1). A short already queued or published shows its state instead of the button.
- **YouTube panel** (new, inside Shorts; laid out for a phone first):
  - **Status line:** connected channel or **Connect**; then "Next: <day time> · <title>", or **Paused**, or "Queue empty".
  - **Queue:** cover, title, ↑ ↓, Edit (same sheet), Remove, **Post now**.
  - **Schedule:** time, days, Pause switch.
  - **Posted:** last 20, each with its YouTube link; failed ones show the error and **Retry** (back to `queued`, attempts reset, top of the queue).
  - When `published_privacy` is `private` but `privacy` asked for public/unlisted: "Uploaded as private: YouTube keeps uploads from unaudited apps private. Make it public in YouTube Studio."

## Publishing run

`POST /api/social/youtube/publish` (`cronAuthorized`), for the owner:

1. **Due check** (pure function, unit-tested): not paused; today (in `timezone`) is in `days`; now ≥ today's `post_time`; and no row with `posted_by = 'schedule'` has `published_at` within today's local date. Not due → 204. (A **Post now** is extra: it doesn't use up the day's scheduled slot.)
2. **Pick:** a row already `uploading` first (to finish it), else the lowest `position` with status `queued`. None → 204.
3. **Token:** decrypt the refresh token, mint an access token at `https://oauth2.googleapis.com/token`. `invalid_grant` → set the connection `reconnect_required`, stop (the row stays queued).
4. **Upload** (resumable):
   - No `upload_url`: `POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status` with the snippet (title, description, tags, categoryId, defaultLanguage `en`) and status (privacyStatus, selfDeclaredMadeForKids, embeddable true). Store the session URL; status `uploading`.
   - Send the file from `bytes_sent` in 8 MB chunks with `Content-Range`, reading byte ranges of the object from storage, until done or ~45 s have passed. Save `bytes_sent` after each chunk.
   - Unfinished → return; the next run resumes. A 404/410 on the session → clear `upload_url` and `bytes_sent` and start again next run.
5. **Done:** store `youtube_id`, `published_privacy`, `published_at`, `posted_by`; status `published`; update the connection's `last_published_at`.

**Post now** (server action) runs steps 2–5 for one chosen row, skipping the due check. It takes the same row lock, so it can't race the cron run.

**Concurrency:** a row moves to `uploading` with a status-guarded update, so two runs never upload the same row.

**Errors**

| Case | What happens |
|---|---|
| Token revoked / `invalid_grant`, or a 401 after a fresh token | Connection → `reconnect_required`; banner in Shorts; queue untouched |
| 403 `quotaExceeded` / `uploadLimitExceeded` | Row stays first; tried again the next posting day; note in the panel |
| Other 4xx/5xx, network | `attempts` + 1, error stored; after 3 → `failed`, next row posts on the next due day |
| File missing in storage | `failed` at once with "video file missing" |

## Moving over from the PC publisher

1. **Import** (one-off, `workers/shorts-studio`: `npm run import-youtube-queue`): reads `~/faceless-shorts/publisher/queue.json` and `published.json`. For each queued project not yet published, it uploads the newest `renders/*.mp4` and `renders/cover.jpg` to `shorts/<owner>/imported/<project>/`, and inserts a `youtube_queue` row from `<project>/youtube.json` in queue order (`job_id` null). It's safe to re-run: it skips projects already queued (same `video_path`).
2. The owner connects YouTube in Orbis.
3. Only then: `systemctl --user disable --now yt-publish.timer`. `yt.py` and its files stay as a fallback.

## Testing

- **Unit (Vitest, existing style), with Google and storage faked:**
  - due check: timezones, day list, paused, already posted today by the schedule, a manual post earlier today (still due), before and after post time;
  - queue details: title trim, `#shorts` appended once, tag merge, de-dup and the 500-character limit;
  - upload state machine: one-run finish, resume across runs, session 404 restart, quota error, attempts → failed, `invalid_grant` → reconnect;
  - publish route: 401 without `CRON_SECRET`, 204 when not due.
- **Import:** order kept, already-published skipped, re-run is a no-op.
- **Live check (owner, once):** connect, queue one short as **private**, **Post now** from the phone, confirm it's on the channel, delete it.

## Out of scope

Custom thumbnails (blocked for unaudited apps), YouTube stats in Social Insights, cross-posting the same short to Instagram/Threads, more than one post per day, and the Google audit request itself.
