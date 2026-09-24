# Daily AI Notifications Design

## Goal and constraints

Orbis sends the signed-in user four short, AI-written phone notifications a day, built around their routine: morning gym, 2 PM lunch, 7 PM end of work, and night. Each notification summarizes what matters right now (calendar events, habits, goals, spending, fitness) and offers one or two grounded suggestions. Notifications arrive as real lock-screen pushes from the installed Orbis web app and are also kept in an in-app inbox behind the header bell.

Constraints:

- Web only (no native wrapper). Push uses the Web Push standard; on iPhone it requires iOS 16.4+ and Orbis installed to the home screen.
- Deployed on Vercel Hobby, which allows only daily crons, so scheduling is driven by Supabase `pg_cron` + `pg_net`.
- AI goes through the existing `requestOpenRouterJson` helper (`lib/ai/openrouter.ts`).
- Suggestions are informational: no medical diagnoses, no investment advice, nothing that is not in the supplied data.

## Slots

| Slot | Default local time | Focus |
|---|---|---|
| `morning` | 06:30 | Today at a glance: first events, workout nudge from the fitness persona, the 1–2 most important habits |
| `lunch` | 14:00 | Upcoming afternoon events, a food/hydration suggestion aligned with fitness goals, open habits |
| `evening` | 19:00 | End-of-work wrap-up: today's spending vs typical, habits done/left, one evening suggestion |
| `night` | 22:00 | Wind-down: habits left to close, sleep nudge, preview of tomorrow's first events |

Times and per-slot on/off are editable in the app. Default timezone is `Asia/Kolkata`.

A slot is **due** when the current local time is within `[slot time, slot time + 45 min)` and no `notifications` row exists for `(user, slot, local date)`. Slots missed by more than 45 minutes are not sent.

## Architecture

```
Supabase pg_cron (*/15 * * * *)
  └─ pg_net POST {SITE_URL}/api/notifications/dispatch  (Authorization: Bearer CRON_SECRET)
        ├─ load users with enabled preferences and a due slot
        ├─ per user: build context → OpenRouter → {title, body} (or fallback)
        ├─ insert notifications row (unique user/slot/date claims the send)
        └─ web-push to each push_subscriptions row; delete 404/410 endpoints
Phone service worker (public/sw.js) → showNotification → click opens /?notifications=open
```

### Units

- `lib/notifications/schedule.ts`: pure functions. `dueSlots(preferences, now)` returns the slots due for a user, and the local date. It handles timezone, the 45-minute window and day boundaries. No I/O.
- `lib/notifications/context.ts`: `buildNotificationContext(admin, userId, slot, localDate)` gathers and trims the inputs:
  - calendar events (today; for `night`, tomorrow too)
  - habits and today's check-ins
  - goal progress
  - today's and this month's spending, and the pending alert count
  - fitness persona, preferred name, and at most 5 recent context notes

  Output is capped at 8 KiB of JSON.
- `lib/notifications/compose.ts`: `composeNotification(slot, context)` calls OpenRouter with a slot-specific system prompt.
  - Validates `{skip: boolean, title ≤ 60 chars, body ≤ 180 chars}`.
  - When there is no valid AI output, `fallbackNotification(slot, context)` produces a rule-based message, in the style of the existing Daily Orbis Brief.
  - Logs every call to `ai_generation_events` with feature `daily_notification`.
- `lib/notifications/push.ts`: wraps `web-push` with VAPID keys. `sendToUser(admin, userId, payload)` sends to every subscription and deletes 404/410 endpoints.
- `lib/notifications/repository.ts`: reads and writes preferences, subscriptions and the inbox.
- `lib/google/calendar.ts`: `listEvents(accessToken, dayStart, dayEnd, timeZone)` via the Calendar REST API (`events.list`, `singleEvents=true`, `orderBy=startTime`). Returns at most 25 events as `{start, end, title, allDay}`, with titles trimmed to 80 chars and a 10s timeout.
- `app/api/notifications/dispatch/route.ts`: the POST handler.
  - Checks the bearer secret with a constant-time comparison and returns 401 on mismatch.
  - Processes users one at a time, independently.
  - Stops starting new users after about 50s, so they are picked up by the next run.
  - Returns counts: sent, skipped, failed.
- `app/notifications/actions.ts`: Server Actions:
  - save preferences
  - subscribe/unsubscribe the current device
  - mark read
  - list inbox
  - send a test notification, rate-limited to 5 per day

### Google Calendar access

The existing Google OAuth flow (`lib/gmail/oauth.ts`) is extended:

- It requests `https://www.googleapis.com/auth/calendar.readonly` alongside `gmail.readonly`. `include_granted_scopes` is already set.
- The granted scopes are stored in a new `gmail_connections.granted_scopes text[]` column.
- Calendar is only called when that list contains the calendar scope.
- It reuses the existing encrypted refresh token and access-token refresh logic.
- Event data is used only in memory to build the message. Only the final notification text is stored.

## Data model

Migration `202609240012_notifications.sql`. All tables have RLS on; users can read and write only their own rows, and dispatch uses the service role.

- `notification_preferences`:
  - `user_id` (primary key, references `auth.users`)
  - `enabled boolean default false`
  - `timezone text default 'Asia/Kolkata'`
  - `morning_time time default '06:30'`, `lunch_time time default '14:00'`, `evening_time time default '19:00'`, `night_time time default '22:00'`
  - `morning_enabled`, `lunch_enabled`, `evening_enabled`, `night_enabled` (booleans, default true)
  - `updated_at`
- `push_subscriptions`:
  - `id`, `user_id`, `endpoint text unique`, `p256dh text`, `auth text`, `user_agent text`, `created_at`
  - At most 10 per user.
- `notifications`:
  - `id`, `user_id`, `slot text check in (morning, lunch, evening, night, test)`, `local_date date`
  - `status text check in (sent, skipped, failed)`
  - `title text`, `body text`, `read_at timestamptz`, `created_at`
  - Unique `(user_id, slot, local_date)` where `slot <> 'test'`. Inserting this row is what claims a send, so overlapping or retried cron runs cannot double-send.
- `gmail_connections`: add `granted_scopes text[] not null default '{}'`.
- `ai_generation_events`: extend the feature check to include `daily_notification`.

Supabase scheduler SQL is documented in the README rather than committed as a migration, because it contains the deployment URL and secret:

- `create extension pg_cron`
- `create extension pg_net`
- `cron.schedule('orbis-notifications', '*/15 * * * *', $$ select net.http_post(...) $$)`

The secret is read from Supabase Vault.

## AI composition

- Input: the trimmed context JSON, the slot name, the local time and the user's preferred name. Calendar titles and notes are marked as untrusted data, never instructions.
- System prompt rules:
  - Use only the supplied facts. Never invent events or numbers.
  - Give one clear main point and at most two suggestions.
  - Be friendly and brief. No medical diagnosis and no investment advice.
  - Set `skip: true` if there is nothing useful to say.
- Output: `maxTokens` 300. JSON is validated, lengths are enforced by truncation, and any other fields are dropped.
- `skip: true` records a `skipped` row and sends no push.
- Any provider or validation error uses `fallbackNotification`. The row is still `sent`, and the AI event is logged as `failed`.

## UI

- **Bell button** in `components/orbis-app.tsx`:
  - Shows an unread dot and opens a Notifications sheet listing the latest 30, newest first.
  - Opening the sheet marks them as read.
  - The `?notifications=open` query param opens the sheet directly; the service worker uses it on click.
- **Personal tab → Notifications card**:
  - Master switch, and the four slots with time input and toggle.
  - This device's status, the Enable button, and "Send test notification."
  - On iOS Safari when Orbis is not in standalone mode, show "Add Orbis to your Home Screen" steps instead of the Enable button.
  - When Google is connected without calendar scope, show "Reconnect Google to include your calendar."
- **Installability**:
  - `app/manifest.ts` (name Orbis, `display: standalone`, theme colors from `globals.css`).
  - Icons `public/icons/icon-192.png`, `icon-512.png` and a maskable variant.
  - `public/sw.js` handles `push` and `notificationclick`, registered from a small client component in the root layout.
- **Middleware**: `proxy.ts` matcher excludes `/api/notifications/dispatch`, `/sw.js` and `/manifest.webmanifest`.

## Configuration

New env vars (documented in `.env.example` and the README):

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:` address)
- `CRON_SECRET`

New dependency: `web-push` (+ `@types/web-push`). Dev: `vitest` for unit tests.

One-time setup:

1. Generate VAPID keys with `npx web-push generate-vapid-keys` and set the env vars on Vercel.
2. Apply migration 012, enable `pg_cron`/`pg_net`, store the secret in Vault and schedule the job.
3. Add the `calendar.readonly` scope to the Google OAuth consent screen, then reconnect Google in Orbis.
4. On the phone: install Orbis to the home screen, open it, and turn notifications on under Personal.

## Error handling

| Failure | Behavior |
|---|---|
| Wrong/missing cron secret | 401, nothing processed |
| One user's send throws | Logged, row marked `failed`, other users continue |
| Calendar fetch fails / token revoked | Compose without calendar |
| AI error, timeout, invalid JSON | Rule-based fallback is sent |
| Push endpoint 404/410 | Subscription deleted |
| Push other error | Logged; inbox row still exists |
| Run nearing time limit | Stop starting new users; next run (≤15 min) catches up within the window |
| No subscriptions | Inbox row still created (visible in-app) |

## Testing

- Unit (Vitest):
  - `dueSlots`: window edges, disabled slots, timezone offsets, midnight rollover, already-sent days.
  - Context trimming stays under 8 KiB.
  - Compose validation: truncation, the skip flag, and falling back on bad JSON.
  - `fallbackNotification` for each slot.
- Route: the dispatch handler with admin, AI and push mocked. Covers the 401 path, a dedupe on second run, and a 410 removing a subscription.
- Manual: test-send from Personal on a real phone (installed PWA), then watch one full day of the four slots.

## Out of scope

- Other calendars (Outlook/iCloud)
- Email/Telegram delivery
- Per-notification actions such as "check in habit" from the notification
- Saving health workbook data
- Multiple languages
