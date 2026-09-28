# Social Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Orbis a private, month-by-month planner for the user's own social media: plan posts on a calendar, draft captions (by hand or with AI), attach a picture or video, mark each post ready, and record where and when it went out.

**Origin:** A port of the "Organic Social" section of WBT Command HQ (`/my-clients/[clientId]/social`). That version is an agency tool: a team writes a month of posts for a client, pushes the month, and the client approves or requests changes per post. Orbis has one user and no client, so the two-sided review becomes a one-person workflow. What was kept, changed and dropped is listed in [Appendix A](#appendix-a--what-was-ported-from-wbt-and-what-was-not).

**Architecture:** One row per post in an owner-private table, grouped by `period` (first day of the month). An append-only revisions table keeps each post's history. Pure helpers in `lib/social/` hold every rule (month maths, readiness, status labels, caption limits) so they are unit-testable and shared by server and browser. Server Actions validate everything and write through the user's own RLS session. AI drafts go through the existing `lib/ai/router.ts` (`routeJson`), never directly to a provider.

**Tech Stack:** Next.js 16 Server Actions, Supabase Postgres + RLS + Storage, `lib/ai/router.ts`, React client components, Vitest for pure helpers.

## Global Constraints

- Every Server Action re-derives the user from `supabase.auth.getClaims()` and `isAppUnlocked()` (same `authed()` helper as `app/routines/actions.ts`). Never accept a user id from the browser.
- All reads and writes use the RLS-bound server client. The admin client is only for AI telemetry, which the router already handles.
- The AI never overwrites words the user wrote. AI output is always added as new `draft` posts; replacing is a user action.
- AI requests default to `sensitivity: 'general'` and send only what the user typed into the brief. Profile details ("More about me") are included only after a separate opt-in tick, and then the request is `'personal'` (so it can only reach a no-training provider, per the router).
- Month and "today" are computed in `Asia/Kolkata`, like `lib/focus/types.ts`.
- Media files go in a private Storage bucket under `<user_id>/…`, served only through short-lived signed URLs.
- Per the project's standing instruction, validate with `pnpm build`; the pure-helper tests are there for whoever chooses to run them.

## Review Focus

- A post with a `planned_for` outside its month, a reel/story without media, or a blank caption must never reach `ready`.
- A browser-supplied post id belonging to another user must fail (RLS plus an explicit `user_id` filter).
- Double-clicking "Create month", "Generate", or "Mark published" must not create duplicates or corrupt state.
- AI returning junk (bad JSON, 40 posts, dates in another month, 10,000-character captions) is trimmed or dropped, never saved raw.
- Deleting a post keeps its history rows readable.

---

## How it works (what the user sees)

1. **Social tab** opens on the current month. Header: `‹ September 2026 ›` switcher, month summary ("12 posts · 7 ready · 3 published"), **+ New** (Post / Reel / Story), **Draft with AI**.
2. **Calendar view** (default): Monday-start grid of the month. Each post appears as a chip on its `planned_for` day: small thumbnail (or a coloured tint per format), title, format and status. More than 2 in a day shows "+n more". Posts without a date sit in a **"No date yet (n)"** tray under the grid. Other views: **List** (sortable rows) and **Grid** (cards).
3. **Post drawer** (opens on click; full screen on phone): format picker, date, title, headline, caption with a live counter per selected platform (for example "Instagram 212 / 2,200 · X 212 / 280 ⚠"), hashtags, platforms, media (upload / replace / remove), **Save**, **Mark ready**, **Mark published**, a ⋯ menu (Duplicate, Move to another month, Delete), and a **History** tab.
4. **Statuses:** `idea` → `draft` → `ready` → `published`. "Mark ready" runs the readiness check and says exactly what is missing ("Add a picture or video — reels need one"). Editing a `ready` post's caption or media drops it back to `draft` (the same rule WBT uses: an edit un-approves). A published post is locked; "Mark as not published" unlocks it.
5. **Mark published** asks where (Instagram, Facebook, LinkedIn, X, Threads, YouTube, TikTok, Other) and an optional link, and stamps the time.
6. **Draft with AI:** a small form: what the month is about (free text), how many posts (1–15), formats, platforms, tone, and an unticked "Use my profile to personalise" box. Result: new `draft` posts spread across the month, marked "AI draft" until edited.
7. **Home brief / notifications (optional, Task 7):** "2 posts planned for today, 1 not ready yet".

Empty month: a friendly empty state with **+ New post** and **Draft with AI**. No "Create month" button is needed: a month exists as soon as it has a post (a simplification over WBT, where a month was its own row).

---

## Data model

### Why one row per post (WBT differs)

WBT stores a month as one row with all posts in a JSON list, because it re-used a client-review document table with versions and approvals. Orbis has no reviewer, so one row per post is simpler: calendar queries are plain SQL, two tabs cannot overwrite each other's edits to different posts, and RLS protects each post directly.

### Migration `supabase/migrations/202609280001_social_planner.sql`

```sql
-- Orbis: a private planner for the user's own social posts, month by month.
--
--   social_posts           one row per planned post
--   social_post_revisions  what changed, append-only (the user can read and add,
--                          never rewrite or delete, so history stays honest)
--
-- `period` is the first day of the month the post belongs to. It is separate
-- from `planned_for` so an undated idea still belongs to a month.

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  period date not null check (extract(day from period) = 1),
  title text not null check (char_length(title) between 1 and 120),
  headline text check (headline is null or char_length(headline) <= 200),
  caption text not null default '' check (char_length(caption) <= 5000),
  hashtags text[] not null default '{}' check (coalesce(array_length(hashtags, 1), 0) <= 30),
  format text not null default 'post' check (format in ('post', 'reel', 'story')),
  platforms text[] not null default '{}'
    check (platforms <@ array['instagram','facebook','linkedin','x','threads','youtube','tiktok']::text[]),
  planned_for date,
  status text not null default 'draft' check (status in ('idea', 'draft', 'ready', 'published')),
  -- Private Storage path (<user_id>/<post_id>/<file>), never a public URL.
  media_path text,
  media_type text check (media_type is null or media_type in ('image', 'video')),
  published_at timestamptz,
  published_platform text,
  published_link text check (published_link is null or published_link ~* '^https?://'),
  -- 'ai' until the user edits the caption or title; the drawer shows an "AI draft" tag.
  source text not null default 'manual' check (source in ('manual', 'ai')),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A dated post belongs to the month of its date.
  constraint social_posts_date_in_period
    check (planned_for is null or date_trunc('month', planned_for)::date = period),
  constraint social_posts_published_has_time
    check (status <> 'published' or published_at is not null)
);

create index if not exists social_posts_user_period_idx
  on public.social_posts (user_id, period, planned_for nulls last, position);

alter table public.social_posts enable row level security;
revoke all on public.social_posts from public, anon;
grant select, insert, update, delete on public.social_posts to authenticated;

drop policy if exists "Users manage their own social posts" on public.social_posts;
create policy "Users manage their own social posts" on public.social_posts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table if not exists public.social_post_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Kept when the post is deleted, like routine_events.
  post_id uuid references public.social_posts (id) on delete set null,
  post_title text not null check (char_length(post_title) between 1 and 120),
  action text not null check (action in
    ('created', 'edited', 'ai_draft', 'ready', 'unready', 'published', 'unpublished', 'moved', 'deleted')),
  -- { title, caption, ... } before and after; null where there was nothing.
  previous jsonb,
  snapshot jsonb,
  created_at timestamptz not null default now()
);

create index if not exists social_post_revisions_post_idx
  on public.social_post_revisions (user_id, post_id, created_at desc);

alter table public.social_post_revisions enable row level security;
revoke all on public.social_post_revisions from public, anon;
-- Append-only from the app's point of view: no update, no delete.
grant select, insert on public.social_post_revisions to authenticated;

drop policy if exists "Users read their own social history" on public.social_post_revisions;
create policy "Users read their own social history" on public.social_post_revisions
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users add to their own social history" on public.social_post_revisions;
create policy "Users add to their own social history" on public.social_post_revisions
  for insert to authenticated with check ((select auth.uid()) = user_id);

-- Private media bucket: 50 MB, pictures and short videos only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social-media', 'social-media', false, 52428800,
        array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm'])
on conflict (id) do nothing;

drop policy if exists "Users manage their own social media files" on storage.objects;
create policy "Users manage their own social media files" on storage.objects
  for all to authenticated
  using (bucket_id = 'social-media' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'social-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
```

Add it to `BUILD_ROADMAP.md`'s "apply in SQL Editor" list.

---

## Task 1: Types and pure helpers

**Files:**
- Create `lib/social/types.ts`.
- Create `lib/social/month.ts`.
- Create `lib/social/month.test.ts`.

**Interfaces (`lib/social/types.ts`):**

```ts
export type SocialFormat = 'post' | 'reel' | 'story';
export type SocialStatus = 'idea' | 'draft' | 'ready' | 'published';
export type SocialPlatform = 'instagram' | 'facebook' | 'linkedin' | 'x' | 'threads' | 'youtube' | 'tiktok';

export type SocialPost = {
  id: string;
  period: string;            // 'YYYY-MM-01'
  title: string;
  headline: string | null;
  caption: string;
  hashtags: string[];
  format: SocialFormat;
  platforms: SocialPlatform[];
  plannedFor: string | null; // 'YYYY-MM-DD'
  status: SocialStatus;
  mediaPath: string | null;
  mediaType: 'image' | 'video' | null;
  mediaUrl: string | null;   // signed, filled by the repository, never stored
  published: { at: string; platform: string; link: string | null } | null;
  source: 'manual' | 'ai';
  position: number;
  updatedAt: string;
};

export type SocialRevision = {
  id: string;
  action: string;
  previous: Record<string, unknown> | null;
  snapshot: Record<string, unknown> | null;
  createdAt: string;
};

export const SOCIAL_FORMATS = [
  { id: 'post', label: 'Post', tint: '#cfe6e8' },
  { id: 'reel', label: 'Reel', tint: '#ffdfc6' },
  { id: 'story', label: 'Story', tint: '#dfe3f5' },
] as const;

export const SOCIAL_STATUS_LABEL: Record<SocialStatus, string> = {
  idea: 'Idea', draft: 'Draft', ready: 'Ready', published: 'Published',
};

/** Caption limits the drawer warns about (not enforced by the database). */
export const CAPTION_LIMIT: Record<SocialPlatform, number> = {
  instagram: 2200, facebook: 63206, linkedin: 3000, x: 280, threads: 500, youtube: 5000, tiktok: 4000,
};
```

**Helpers (`lib/social/month.ts`), ported from WBT's `lib/content-gen/monthly.ts`:**

```ts
export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/** '2026-09-01' */
export function periodOf(year: number, month: number): string;
/** 'September 2026' */
export function monthName(period: string): string;
/** The period a date belongs to. */
export function periodOfDate(date: string): string;
/** { year, month } one step either side, wrapping the year. */
export function shiftMonth(period: string, by: -1 | 1): string;

/**
 * Monday-start calendar: 5 or 6 weeks of 7 days. Days outside the month are
 * included with inMonth=false so the grid is always rectangular.
 */
export function monthGrid(period: string): { date: string; inMonth: boolean }[][];

/** Posts per day for the grid, plus the undated tray. */
export function placePosts(posts: SocialPost[]): { byDay: Map<string, SocialPost[]>; undated: SocialPost[] };

/**
 * Why a post cannot be marked ready, in plain words, or null.
 * Ported from WBT's pushProblem(), applied per post instead of per month.
 */
export function readyProblem(post: Pick<SocialPost, 'title' | 'caption' | 'format' | 'plannedFor' | 'period' | 'mediaPath'>): string | null {
  if (!post.title.trim()) return 'Give the post a title.';
  if (!post.caption.trim()) return 'Write a caption first.';
  if (!post.plannedFor) return 'Pick a day for this post.';
  if (!post.plannedFor.startsWith(post.period.slice(0, 8))) return 'Pick a day inside this month.';
  if ((post.format === 'reel' || post.format === 'story') && !post.mediaPath) return `Add a picture or video — ${post.format}s need one.`;
  return null;
}

/** Platforms whose limit the caption (plus hashtags) goes over. */
export function overLimit(caption: string, hashtags: string[], platforms: SocialPlatform[]): SocialPlatform[];

/** The line under the month: '12 posts · 7 ready · 3 published' or 'Nothing planned yet'. */
export function monthSummary(posts: SocialPost[]): string;

/** Does this edit knock a ready post back to draft? True when caption, title, media or format changed. */
export function editUnreadies(before: SocialPost, after: Partial<SocialPost>): boolean;
```

- [ ] Write the types and helpers above.
- [ ] Tests: `periodOf(2026, 9)`; `shiftMonth('2026-12-01', 1) === '2027-01-01'`; `monthGrid('2026-09-01')` starts Monday 31 Aug and has 5 rows; `readyProblem` for each failure and a pass; `overLimit` flags X at 281 characters; `monthSummary([])`.

## Task 2: Repository

**Files:**
- Create `lib/social/repository.ts` (`import 'server-only'`).

**Interfaces:**

```ts
listMonth(userId: string, period: string): Promise<{ posts: SocialPost[]; databaseReady: boolean }>;
getPost(userId: string, id: string): Promise<SocialPost | null>;
insertPost(userId: string, input: NewPost, action: 'created' | 'ai_draft'): Promise<SocialPost>;
updatePost(userId: string, id: string, patch: PostPatch): Promise<SocialPost>;
setStatus(userId: string, id: string, status: SocialStatus, published?: { platform: string; link: string | null }): Promise<SocialPost>;
deletePost(userId: string, id: string): Promise<void>;
listHistory(userId: string, id: string, limit?: number): Promise<SocialRevision[]>;
signedMediaUrl(path: string): Promise<string | null>; // 1 hour
```

- [ ] Use the RLS-bound `createClient()` from `lib/supabase/server.ts`, and also filter `.eq('user_id', userId)` explicitly.
- [ ] `listMonth` answers `databaseReady: false` on "table missing" errors (`42P01` / `PGRST205`) so the tab shows "Apply the social migration" instead of crashing, the same way Finance does.
- [ ] Sign media URLs in one batch (`createSignedUrls`) for the month, not one call per post.
- [ ] Every write inserts one `social_post_revisions` row AFTER the post write succeeds, inside a try/catch: a history row failing must never undo a real edit, and a history row must never describe a change that did not happen. (Rule carried over from WBT's `recordRevision`.)
- [ ] `updatePost` skips the write (and the history row) when nothing actually changed.
- [ ] `updatePost` sets `status = 'draft'` when `editUnreadies()` is true and the post was `ready`; sets `source = 'manual'` when the title or caption changes.
- [ ] `deletePost` also removes its Storage file (best-effort), then writes a `deleted` history row with the last title and caption.

## Task 3: Server Actions

**Files:**
- Create `app/social/actions.ts`.

**Interfaces** (all return `{ success: boolean; message: string; post?: SocialPost; posts?: SocialPost[] }`, like `app/routines/actions.ts`):

```ts
loadSocialMonthAction(period: string);
savePostAction(input: { id?: string; period: string; title: string; headline?: string | null; caption: string;
  hashtags: string[]; format: string; platforms: string[]; plannedFor: string | null });
setPostStatusAction(id: string, status: 'idea' | 'draft' | 'ready');
markPublishedAction(id: string, publish: { platform: string; link?: string | null } | null);
duplicatePostAction(id: string);
movePostAction(id: string, period: string);            // clears plannedFor if it falls outside the new month
deletePostAction(id: string);
signMediaUploadAction(postId: string, file: { name: string; type: string; size: number });
attachMediaAction(postId: string, path: string, type: 'image' | 'video');
removeMediaAction(postId: string);
loadPostHistoryAction(id: string);
```

- [ ] Reuse `authed()` and a `validId()` check; validate `period` with `/^\d{4}-\d{2}-01$/` and `plannedFor` with `/^\d{4}-\d{2}-\d{2}$/` and that it falls inside `period`.
- [ ] Trim and cap: title 120, headline 200, caption 5000, max 30 hashtags (strip leading `#`, store without it, 50 chars each), platforms from the allowed list only.
- [ ] `setPostStatusAction('ready')` returns `readyProblem()`'s message when it fails. A published post can only change via `markPublishedAction(id, null)`.
- [ ] `markPublishedAction` requires status `ready` (WBT: only an approved post can be marked published), a known platform, and a link starting with `https://` when given.
- [ ] Uploads: `signMediaUploadAction` checks type/size against the bucket's list, builds the path `${userId}/${postId}/${randomUUID()}.${ext}` on the server, and returns `createSignedUploadUrl`. The browser uploads straight to Storage; `attachMediaAction` then checks the path starts with `${userId}/${postId}/` before saving it. Replacing media deletes the old file.
- [ ] Every write calls `revalidatePath('/')` (Orbis is one page with tabs).
- [ ] Friendly messages throughout ("Pick a day inside September."), never raw errors.

## Task 4: AI drafts

**Files:**
- Create `lib/social/ai-draft.ts`.
- Create `lib/social/ai-draft.test.ts` (parser only).
- Modify `app/social/actions.ts` (add `draftMonthWithAiAction`).

**Interface:**

```ts
draftMonthWithAiAction(input: {
  period: string;
  brief: string;            // 1–1500 chars: what the month is about
  count: number;            // 1–15
  formats: SocialFormat[];
  platforms: SocialPlatform[];
  tone: 'friendly' | 'professional' | 'playful' | 'inspiring';
  useProfile: boolean;      // opt-in; switches sensitivity to 'personal'
}): Promise<{ success: boolean; message: string; posts?: SocialPost[] }>;
```

**Prompt (system):**

```
You plan social media posts for one person's own accounts.
Return JSON only: {"posts":[{"title":"","headline":"","caption":"","hashtags":[""],"format":"post|reel|story","day":1}]}
Rules:
- Exactly {count} posts. Formats only from: {formats}. Spread them across the month; "day" is the day of the month (1-{daysInMonth}).
- Captions must fit the strictest platform chosen ({limit} characters including hashtags).
- For a reel, start the caption with "On-screen script:" and 3-5 short lines, then the caption.
- 3-8 hashtags each, no "#" sign. No emojis unless the tone is playful.
- Write in plain {tone} language. Do not invent facts, prices, dates or claims about the person.
- Never repeat the same opening line twice.
```

**User message:** month name, the brief, platforms, and, only when `useProfile` is ticked, preferred name, work/role and "More about me" from the personal profile.

- [ ] Call `routeJson({ userId, feature: 'social_drafts', sensitivity: useProfile ? 'personal' : 'general', system, user, maxTokens: 3000, temperature: 0.7, timeoutMs: 30_000 })`.
- [ ] `null` result → "No AI model is available right now. Try again later or write the posts yourself." (the router's documented fallback signal).
- [ ] `parseAiDraft(text, { period, count, formats })` (pure, tested): `JSON.parse` in try/catch; keep at most `count` posts; drop entries with no caption; clamp lengths with the same caps as Task 3; drop unknown formats to `post`; turn `day` into `plannedFor` only when it is a real day of that month, else null.
- [ ] Insert each as `status: 'draft'`, `source: 'ai'`, with an `ai_draft` history row. Never touch existing posts. (WBT's rule: AI never overwrites words a person edited.)
- [ ] Apply a daily cap (for example 10 generations per user per day), using the same budget approach as the existing workbook advice limit.

## Task 5: The Social screen

**Files:**
- Create `components/social/social-screen.tsx` (month switcher, summary, view tabs, + New, Draft with AI).
- Create `components/social/social-calendar.tsx`.
- Create `components/social/social-list.tsx`.
- Create `components/social/post-drawer.tsx`.
- Create `components/social/ai-draft-dialog.tsx`.
- Create `components/social/status-chip.tsx` (one place for status colours; always shows the label text, not colour alone).
- Modify `components/orbis-app.tsx`: add `'social'` to `Tab`, `TAB_TO_HASH` (`social: 'social'`), the tab bar, and the render switch.
- Modify `lib/focus/types.ts`: add `'social'` to `FocusTarget` if Home should link to it.
- Modify `app/page.tsx`: load the current month's posts server-side with the other summaries.

- [ ] Month switcher keeps the month in the URL hash state (for example `#social/2026-09`) so reload stays put.
- [ ] Calendar: Monday-start, 5–6 rows; outside-month days greyed; chip = thumbnail/tint + title (ellipsis) + "Reel · Ready"; "+n more" after 2; "No date yet (n)" tray below. Tapping an empty day opens a new post on that date.
- [ ] Phone (< 640 px): calendar collapses to an agenda list grouped by day; the drawer becomes a full-screen sheet with a sticky Save / Mark ready footer. No horizontal scroll.
- [ ] Drawer: live per-platform caption counter using `overLimit()`; "AI draft" tag while `source === 'ai'`; Mark ready shows `readyProblem()` inline under the button; History tab lists actions newest first with a before/after view for edits.
- [ ] One `useTransition` for writes; disable only the pressed button; show results as an inline message near the action.
- [ ] Nice-to-have: drag a chip to another day → `savePostAction` with the new `plannedFor`.
- [ ] Tab bar crowding: the bottom bar already has 5 tabs. If a 6th does not fit on a phone, put Social inside Personal as a section instead; decide once you see it on a 390 px screen.

## Task 6: Home brief row

- [ ] Add a `lib/focus/social.ts` composer: quiet row "Social · 2 today, 1 not ready" (empty when nothing is planned), target `'social'`.

## Task 7 (optional): Reminders

- [ ] Hook into the existing `lib/notifications/compose.ts` / `schedule.ts`: at the user's morning notification time, "2 posts planned for today — 1 still needs a picture." Only when there is something due; never more than one social nudge per day. (WBT batches its reminder emails the same way: one message, not one per post.)

## Task 8: Roadmap and build

- [ ] Add a "Social planner" phase to `BUILD_ROADMAP.md` with the migration in the apply list.
- [ ] `pnpm build` passes.
- [ ] Manual check with the signed-in account: create a post, try Mark ready with a missing picture on a reel, fix it, mark ready, edit the caption (drops to draft), mark ready again, mark published with a link, check History, delete, confirm the history row survives.

---

## Appendix A — What was ported from WBT, and what was not

| WBT Organic Social | Orbis Social planner |
|---|---|
| Month = one DB row with posts in a JSON list, versioned | One row per post, grouped by `period` |
| Team creates a month, pushes it to the client, can take it back | No push. Nothing is shared. |
| Client approves / requests changes per post, with feedback | The user marks a post **Ready** themselves |
| "Edited by client" flag until the team acknowledges | Dropped (one person) |
| Any edit resets the post to "to review" | Any caption/media edit drops **Ready** → **Draft** |
| Push blocked unless every post has title, caption, a date in the month, and media for reels/stories | Same checks, per post, on **Mark ready** |
| Only an approved post can be marked published; published posts are locked | Same, with **Ready** in place of approved |
| Publish record: platform + link + who + when | Platform + link + when |
| Append-only history (who changed what, before/after) | Same, per post |
| Voice notes / videos / photos attached to a post (5 files, 50 MB) | One picture or video per post, 50 MB |
| AI Studio (external system) generates runs; posts sync in; "AI Studio has a newer version — Take it / Keep ours" | Built-in "Draft with AI" through Orbis's router; drafts are only ever added, never overwrite |
| Bell notifications + batched emails + day-3/day-7 reminders to the client | Optional single daily nudge |
| Board card that follows the month's status | Home brief row |
| Proposed calendar view with "no date yet" tray (WBT design doc) | Built as the default view |

Worth keeping in mind for later: if the user ever wants someone else (a friend, a designer) to review posts, WBT's push / take back / approve per post flow is the model — a share link per month, a reviewer who can only approve or comment, and the "an edit un-approves" rule.

## Appendix B — Other WBT Command HQ ideas that suit Orbis

Ranked by how much they would add for the least work:

1. **Append-only history for Journal and Notes.** The revisions pattern in this plan (write the change, then a history row; never rewrite history; a restore is a new edit) fits the journal and context notes directly. "What did I change in this entry, and when?" becomes one tab.
2. **Batched, capped reminders.** WBT never sends one message per event: fixes within 15 minutes become one email, and reminders go out on day 3 and day 7 only while something is still waiting. The same rule would keep Orbis nudges ("3 bank alerts waiting for review") calm instead of noisy.
3. **"Newer version waiting — take it or keep yours."** When an automatic source changes something the user already edited, WBT keeps the user's version and parks the new one beside it. Useful wherever Orbis syncs over user edits (Gmail transactions re-parsed, broker holdings refreshed over manual entries).
4. **Ask your own data (RAG).** WBT's "Ask Ava" answers questions from the company's own records with citations. The roadmap already considers pgvector for notes; the same idea across journal, notes, spending and health plans ("How did my sleep look in the weeks I journalled about stress?") is Orbis's natural big feature, and the router's `personal` sensitivity rule already covers the privacy side.
5. **Soft "take back" instead of delete.** WBT hides a withdrawn document with a timestamp rather than deleting it, so nothing is ever lost. Good for goals, habits and routines the user archives.
6. **Voice notes on items.** WBT lets people attach a voice note to a post. For Orbis, a voice note on a journal entry or a routine check-in is a quick capture on a phone.
