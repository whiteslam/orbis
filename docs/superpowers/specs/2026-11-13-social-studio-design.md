# Social Studio: the redesigned Social page

Date: 2026-11-13 · Status: **draft, for the owner's approval** · Mockup: design 03 "Studio split" on the canvas https://claude.ai/artifact/SVv4AYVdXvTVNSE4KKtB4S (private to the owner).

## Why

The owner uses Social from three places: the office Windows PC, the phone (soon the Android app), and the home Linux PC that makes shorts. Today's page is a month calendar plus a Shorts tab in a narrow column. The owner picked design 03 from ten options and asked for it built in full: a composer on the left, posts that look like Instagram posts, and a live column on the right. They also want Orbis to start promoting itself from a separate Orbis Instagram page.

## Goals

- **Composer:** writing a post means typing a caption and attaching a photo or video in one box, then pressing **Add**.
- **Posts as previews:** each post looks like an Instagram post (photo, caption, status), not a row of text.
- **Live column:** what's happening with shorts is visible from both tabs.
- **Orbis promotion:** for the **Orbis** account only, Orbis suggests posts and makes their images, and the owner keeps, retries or edits each one.
- **Phone first:** every part works on a phone and in the coming Android app.

## Non-goals (this round)

- **AI suggestions for the owner's own posts.** The owner writes those. Learned suggestions come later, once Orbis has a memory of their posts.
- **Automatic publishing to Instagram, YouTube or Reels.** That's part 3, a separate design. The YouTube design is already approved: `2026-11-13-youtube-publishing-design.md`.
- **Posting times.** A post keeps a day, not a time, as today.

## Anti-goals

- **No made-up claims in promotion posts.** Promotion posts state only facts from a fixed, owner-checked list. They never say "never trains AI on your data" while that claim is untrue.
- **No AI on the owner's account.** Nothing is drafted or suggested there.
- **No new background colour.** The glow wallpaper on #0E0E10 stays.

## Approaches considered

1. **Re-lay the existing parts into the new frame (chosen).** Keep `social_posts`, the signed media upload, `PostDrawer` for full editing, `ShortsView`'s pieces and the AI router, and build a new page layout, composer, post card and live column around them. This is the smallest change: data and actions are already tested.
2. **A new Social app from scratch.** Cleaner on paper, but it throws away tested actions (revisions, media, month moves) for no gain the owner asked for.
3. **A chat-style AI composer (the mockup's first reading).** The owner rejected it for their own posts. Promotion keeps a **Suggest** button instead of a chat.

## Decisions

### Page frame (parts 1 and 2)

- **Header:** "Social", then the tabs **Posts | Shorts**. A third tab, **YouTube & Reels**, arrives with part 3. The URL hash keeps the tab, as now (`#social`, `#social-shorts`).
- **Desktop:** two columns. The main column is about 2/3; the live column is about 1/3, sits at the right and stays visible on both tabs.
- **Phone (<720 px):** one column. The live column becomes a single tappable summary line above the content ("● Shorts PC online · 1 needs you"); tapping it opens the Shorts tab.
- **Removed:** the month calendar view and the **Draft with AI** entry. `AiDraftDialog` and `draftMonthWithAiAction` stay in the code, unused by the page.

### Posts tab (part 1)

- **Account switch** above the composer: **Me | Orbis**.
  - Each post gets an `account` field, `'me'` (the default; every existing post) or `'orbis'`. The grid shows the chosen account's posts.
  - **Orbis** is shown only to the owner (role check through `lib/security/roles.ts`). Anyone else sees no switch.
- **Composer** (both accounts):
  - a caption box;
  - an attach button that uses the existing `signMediaUploadAction` / `attachMediaAction` flow, with a thumbnail preview before **Add**;
  - three chips: format (Post / Reel / Story), day (none / a date), platforms (default Instagram).
  - **Add** saves a `draft` post with `source: 'manual'`. The title is the caption's first line, cut to the existing title limit; editing later uses `PostDrawer` as now.
- **Post card:** an Instagram-style card.
  - Header: the account name and the day.
  - Media: the 1:1 photo or video. With no media, the headline (or title) is drawn on the format's tint.
  - Caption, cut to 2 lines, then the format and status chips.
  - Tapping it opens `PostDrawer`.
- **Grouping:** the month is still the unit of loading, with ‹ › to change month. Inside the month the cards are grouped **Coming up** (dated from today), **No date** and **Posted**. The grid is auto-fill with a minimum card width of 200 px.
- **Instagram stats** (`SocialInsights`) stay, below the grid, shown when an account is connected.

### Orbis promotion (part 1b)

- With **Orbis** selected, the composer gains **Suggest posts** (1–3 per press).
- **Text:** through the existing router (`routeJson`, a new feature key `social_promo`, `sensitivity: 'general'`). The prompt holds only the fixed facts list, plus an optional one-line brief from the owner. The reply has the same shape as `parseAiDraft`.
- **Facts list:** `lib/social/orbis-facts.ts`, short true statements about Orbis written from the landing page and checked by the owner before first use. It leaves out the AI-training claim.
- **Images:** one image per suggestion, from Gemini's image model with `GEMINI_API_KEY` (already set; no new account). The prompt is built from the post's headline plus a fixed Orbis visual brief: dark #0E0E10, teal/blue glow, no text baked into the image, no people's faces. The PNG/JPEG is stored in the existing private `social-media` bucket under the owner's folder and attached like an upload (`mediaType: 'image'`).
- **Saving:** suggestions are saved as `draft` posts with `source: 'ai'` and `account: 'orbis'`, so they show up as cards right away. Each AI card has **Keep** (marks it `ready`), **Try another image** (regenerates only the image) and **Edit**. Discard uses the existing delete.
- **Cost and limits:** suggestions spend the existing `consume_social_ai_request` daily credit. Image retries spend it too. The daily cap and the gap stay as they are.
- **Failure:** if the text works but the image fails, the card is kept with the tint fallback and the note "Image couldn't be made. Try another image."

### Shorts tab (part 2)

- The same frame. The main column has the style picker and the intake form, as now, then the library as 9:16 cards. The live column is shared with the Posts tab.
- No behaviour changes to queueing, plans, the worker or downloads. This is layout and styling only.

## Data change (one migration)

- `social_posts`: add `account text not null default 'me' check (account in ('me','orbis'))`.
- The insert/update policies are unchanged. The server action refuses `'orbis'` from a non-owner.
- As with past migrations, the owner pastes it into the Supabase SQL editor (there's no DB URL in `.env.local`).

## Testing

- **Unit:** title from caption; card grouping (coming up, no date, posted, with today's edge); the account filter; the non-owner `'orbis'` refusal; the promotion prompt holds only the facts list and the brief; parsing promotion replies; image-failure fallback.
- **Existing suites stay green**, including the Shorts tests and the social action tests.
- **Owner live check:** add a post with a photo from the phone; press Suggest posts once on the Orbis account; keep one, retry one image.

## Left to the builder

- Exact component split and CSS (Apple-style tokens already in `app/styles`).
- The Gemini image model id and request shape: check the current Gemini docs at build time.
- Whether the live column polls (the Shorts view already refreshes while work is running) or reuses that refresh.
