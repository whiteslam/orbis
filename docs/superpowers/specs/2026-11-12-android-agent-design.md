# Orbis for Android: the phone agent — design and build roadmap

**Date:** 2026-11-12 · **Status:** for the owner's approval · **Branch:** `android-agent` · **Launch market:** India first

## 1. Intent

Orbis becomes an Android app that runs in the background, reads what its user allows on their own phone, and acts on one command. The aim is better output: answers, briefs and heads-ups grounded in what is actually happening in the person's life, not only in what they typed into Orbis.

The owner's words (2026-11-12): it runs in the background and keeps track of the person so the AI becomes a good "outputer"; it can read mails, calls, messages, notifications and settings; it can use the phone from one command ("message this person on WhatsApp", "open any app"); it pops up on "Hey Orbis"; it never reads the phone's private vault; the person can tell it not to read chosen kinds of data.

Then: **don't build it single-user.** Anyone can create their own account, and Orbis reads nothing until that person turns it on.

## 2. Goals, non-goals, anti-goals

**Goals**
- A multi-user Android app anyone can install and sign up for, built on the existing Next.js + Supabase app.
- Background reading of notifications, calls, calendar, contacts, health, app usage and phone state, each switched on separately by the person.
- One-command actions by voice or text: open apps, message, call, alarms, reminders, Do Not Disturb, settings, navigation, adding expenses and events.
- "Hey Orbis": the default-assistant gesture first, then an opt-in always-on wake word.
- A memory layer that turns all of this into better Ask Orbis answers, heads-ups, briefs and journal drafts.

**Non-goals (for now)**
- iOS. Apple doesn't allow background reading of other apps or controlling them. The web app stays the iOS experience.
- Replacing the web app. The web and desktop keep working; Android adds senses and hands.
- Becoming the phone's default SMS or dialer app.

**Anti-goals: failure even if it technically works**
- Orbis reads, stores or sends anything from a source, app or contact the person excluded, or from the private vault.
- People running Orbis can read a user's raw phone content (message text, call partners) from the database.
- Orbis sends a message, places a call or pays anything without the person's explicit go-ahead.
- Battery drain someone notices. The target is under ~3% a day with reading on and the wake word off.
- A Play Store rejection that takes down the core app, because one risky feature was bundled into it.

## 3. Constraints

- **Stack today:** Next.js 16 App Router on Vercel, Supabase (Postgres, Auth, Storage, RLS on every user table), server actions, an AI router (`lib/ai/router.ts`) reaching OpenRouter (Claude Haiku), Groq and others, Jev as a decision model (`lib/ai/jev.ts`). Read `node_modules/next/dist/docs/` before writing Next code (see AGENTS.md).
- **The app depends on a server.** Server actions and route handlers mean it can't be exported as static files. The Android shell loads the hosted app.
- **Play Store policy:**
  - `READ_SMS` and `READ_CALL_LOG` are limited to default SMS or dialer apps and a few listed exceptions.
  - Using AccessibilityService for anything other than helping disabled users needs a declaration, prominent disclosure, and review.
  - Every permission needs an in-app disclosure before it is requested, plus a complete Data safety form.
- **Android background limits:**
  - Long-running work needs a foreground service with a declared type (Android 14+) and a visible notification.
  - Phone makers' battery killers (Xiaomi, Samsung, Oppo/Vivo, OnePlus) need per-brand guidance in the app.
- **Sideloaded installs on Android 13+:** the person must tap "Allow restricted settings" in App info before notification access or accessibility can be switched on.
- **Repo rules:** unfinished work lives on its own pushed branch, never `main`. The app repo is public, so no secrets in it.
- The owner has lifted the AI cost cap. Design for capability, but keep a per-account quota so one user can't run up the bill.

## 4. Decisions

The owner decided:
- Multi-user with self sign-up, not single-user.
- Nothing is read by default; each kind of data is the person's choice.
- The private vault is never read, and there's a per-person "don't read this" control.
- Background tracking, reading, one-command actions and "Hey Orbis" are all in scope.

Claude's calls (the owner can overturn any of these):

1. **Shell: Capacitor, in remote-URL mode.**
   - The app loads the hosted Orbis site inside Capacitor's WebView, so the UI keeps shipping through Vercel with no app update.
   - Native features are Capacitor plugins written in Kotlin.
   - A bundled offline page shows if the server can't be reached.
2. **Two build flavours from one codebase.**
   - `play` (store) leaves out `READ_SMS`, `READ_CALL_LOG` and accessibility automation, and reads messages and missed calls through notifications instead.
   - `direct` (a downloadable APK from the Orbis site) adds them for people who want everything.
   - The server treats both the same way.
3. **A native core module, `orbis-core` (Kotlin)**, holding:
   - the foreground service
   - the notification listener
   - the local store
   - the privacy rules engine
   - the sync worker
   - the action runner
   - the assistant service and the wake word

   The WebView talks to it through one Capacitor plugin, `OrbisCore`.
4. **Exclusions are applied the moment data is captured.**
   - A blocked app, blocked contact, excluded source or paused state means the item is never written anywhere.
   - OTPs, passwords, card and account numbers are masked on the phone before anything is stored.
5. **Raw data stays on the phone. Facts go to the server.**
   - Raw items (notification text, call entries) live in an encrypted on-phone database (Room + SQLCipher, key in Android Keystore), kept for 30 days by default.
   - What syncs to Supabase are derived **signals**: a transaction, a missed call, a commitment, a package, a calendar clash, daily usage totals.
6. **AI on raw text happens in place and is then forgotten.**
   - When a signal needs AI to extract it (a promise in a chat, for example), the phone sends the masked text to a server endpoint.
   - The endpoint calls the model, stores only the extracted fact, and discards the text.
   - The same applies when Ask Orbis needs a raw item to answer a question.
7. **Phone-only content is encrypted per user at rest.**
   - It is encrypted in the app layer (AES-GCM), so the Supabase dashboard shows ciphertext. This is new work: today's `lib/crypto/credentials.ts` uses one global key for connection tokens. Add per-user keys derived from a server master key (HKDF on the user id).
   - **What's encrypted:** `signals` content, extracted facts, `people` notes and the handles (phone numbers, chat names) taken from contacts and messages, and memory summaries.
   - **What isn't:**
     - Once the person accepts a phone signal into an existing module (a transaction in Money, a job in Career), it becomes an ordinary row there, protected the same way as manual entries today (RLS). Otherwise SQL totals and filters stop working.
     - pgvector embeddings stay unencrypted under RLS, because encrypted vectors can't be searched. They are the most sensitive unencrypted thing on the server, and the privacy policy must say so.
   - **Turning a source off deletes** its signals, its pending-review items, its embeddings and the people links it created. Rows the person already accepted into Money or Career stay: they're the person's records now.
   - This is not zero-knowledge: whoever holds the server's environment can decrypt. Fully end-to-end encryption would rule out server-side AI. See §9.
8. **Phone data goes only to AI providers that don't train on it.**
   - Other people's phone data goes only to providers marked `may_train = false` / `data_collection: deny` (Haiku on OpenRouter as pinned today, and Groq).
   - The owner lifted this rule for their own data. For strangers' data it is also what the Play Data safety form and user trust need.
   - **This guard has to be put back, not just switched on.** `lib/ai/router.ts` currently only logs sensitivity; it no longer filters by `may_train`. Add a `phone` sensitivity that filters on it, with a per-account opt-out that only the owner's role can use.
   - **Where raw phone items reach Ask Orbis:** only inside the Android app. The WebView asks `OrbisCore` for matching raw items and sends them along with the question. Ask on the web and desktop uses synced signals and memory only, so there's no server-to-phone round trip.
9. **Native sign-in uses the same Supabase session.**
   - The WebView hands the Supabase access and refresh tokens to `OrbisCore`, which keeps them encrypted and refreshes them itself, so syncing works without the WebView open.
   - Server endpoints take a bearer token. Reuse the bearer-token request context from the parked `api` branch (`lib/api/context.ts`) rather than rebuilding it.
10. **Actions are tools.**
    - Ask Orbis gains tool calling: the model picks an action, and the phone's action runner does it.
    - Anything that leaves the phone (a message, a call, an email, a calendar invite to others) shows a preview card and waits for a tap.
    - "Trusted" actions that skip the card come later and are opt-in per action and per contact.
    - Simple commands ("open YouTube", "torch on") match on the phone with no cloud call. Jev decides command vs question when unsure.
11. **WhatsApp:** reply through the notification's reply action when there's a fresh notification. Otherwise open the chat with the text already typed, and the person taps send. There's no automated sending through accessibility in the `play` flavour.
12. **"Hey Orbis":**
    - First, Orbis registers as a selectable default digital assistant (`VoiceInteractionService`), so holding the power button or using the assistant gesture opens it.
    - Second, an opt-in wake word running on the phone. Use openWakeWord (Apache-2.0, no per-user licence fee) with a custom-trained "Hey Orbis" model on ONNX Runtime. Fall back to Porcupine only if openWakeWord's quality fails on test phones; Porcupine needs a commercial licence for a multi-user app.
13. **Memory:** pgvector on Supabase for meaning-based search, a `people` table built from contacts and conversations, and a nightly summary per person. Every fact keeps a link to the signal it came from.
14. **The `play` flavour is the one that has to pass review.** Accessibility automation ships only in `direct`, until Google approves it for `play`.

## 5. Architecture

```
Phone
  orbis-core (Kotlin)
    Capture: notification listener · calls · calendar · contacts · Health Connect · usage · phone state
      → Privacy rules (sources on/off, blocked apps/contacts, vault, pause, mask OTPs/numbers)
      → Local store (Room + SQLCipher, 30-day raw retention, activity ledger)
      → On-phone sorting (rules: bank/UPI, delivery, missed call, OTP drop)
      → Sync worker (WorkManager, batches, retries) ── bearer token ──▶ /api/device/*
    Action runner: open app · intents · DND · alarms · reply-from-notification · call
    Assistant service + wake word ──▶ opens the Ask overlay
  Capacitor WebView: hosted Orbis UI, talks to orbis-core through the OrbisCore plugin

Server (Next.js on Vercel)
  /api/device/*: register device, upload signals, extract (process and forget), action results
  Ask Orbis: tool calling + memory search
  Heads-ups v2, briefs, journal draft (crons)
  Supabase: device_*, signals, people, memory (pgvector), activity ledger, consent, quotas: all RLS
```

## 6. Privacy center ("What Orbis can see")

This is a single screen in Settings, and the same rules run on the phone.
- **Sources:** each one is off by default. Turning one on shows a plain explanation (what's read, what's kept, where it goes) and then the Android permission prompt.
- **Blocked apps:** the list starts with banking and password-manager apps pre-ticked, and the person edits it. **Blocked contacts.** **Blocked keywords.**
- **Private vault:** Android 15 Private Space and Samsung Secure Folder are separate profiles, so Orbis can't see them. The screen says so. Any notification from another profile is dropped as a safety net. Verify this on real phones.
- **Pause:** pause for an hour, until tomorrow, or until turned back on.
- **Activity ledger:** every item read (source and time, not the content) and every action taken. Kept on the phone, with a summary on the server.
- **Turning off a source deletes its data** on the phone and on the server, with a confirm step.
- Export and account deletion (`lib/account/`) are extended to cover every new table and the on-phone store.

## 7. Build roadmap

Each phase ends with something you can install and use. Phases 1–2 can overlap once the sync pipe works.

### Phase 0: Multi-user groundwork (web only)
Make the existing app safe and fair for strangers before any phone data exists.
- **Sign-up:** open it on purpose (`ORBIS_OPEN_SIGNUPS`), add Google sign-in, rate-limit sign-ups, and keep email confirmation.
- **Roles instead of an email list:**
  - An `account_roles` table (`owner`, `admin`, `user`).
  - Owner-only features (the Research desk, `lib/research/access.ts`) check the role.
  - `ORBIS_ALLOWED_EMAILS` stays as an emergency "close the doors" switch.
- **Per-person time zone, currency and locale:**
  - `profiles.timezone` exists but defaults to `Asia/Kolkata`.
  - Hard-coded IST/INR appears in ~37 `lib` files and many components, including heads-ups, notifications, routines, Ask and Career.
  - Replace it with the person's settings and one shared date/money helper.
- **Onboarding:** name, time zone, which modules to show, AI on/off, lock.
- **Per-account AI quotas** read from a `plans` table (a free tier now, paid tiers later).
- **Service-role review:** ~30 files use the admin client. List each use, keep the ones crons truly need, and make sure none of them reads user content for anything other than that person's own job.
- **Operations:**
  - A staging Supabase project.
  - Supabase CLI migrations.
  - Sentry with privacy-safe settings.
- **Legal:** update the privacy policy and terms for multi-user use and for the coming phone data.

**Done when:** a stranger can sign up, get a working Orbis in their own time zone and currency, and can't reach anything owner-only.

### Phase 1: Android shell, core service and privacy center
- Capacitor Android project (`android/`) with the `play` and `direct` flavours, loading the hosted app, with an offline page.
- App links (`assetlinks.json`), the app icon and splash.
- **Native push through FCM**, alongside today's web push.
- **Biometric unlock** wired to the existing app lock.
- **The `orbis-core` skeleton:**
  - the foreground service with its "Orbis is active" notification
  - an onboarding step for battery-optimisation exemption, with per-brand help
  - Room + SQLCipher
  - the privacy rules engine
  - the activity ledger
  - the WorkManager sync worker
- **The `OrbisCore` plugin:**
  - hand over the session tokens
  - read and write privacy settings
  - status
  - pause
- **Server side:**
  - `/api/device/register`, `/api/device/signals` (batched, idempotent by signal id) and `/api/device/revoke`.
  - Tables `devices`, `device_sources`, `signals` and `activity_ledger`, all with RLS, plus per-user encryption for signal content.
  - The bearer-token context ported from the `api` branch.
- The privacy center UI (§6), working end to end with one test source.
- Play Console internal testing track.

**Done when:** the APK installs, signs in, stays alive in the background for 48 hours on a Samsung and a Xiaomi test phone, and syncs test signals that respect every exclusion.

### Phase 2: Reading
In this order. Each source is a separate opt-in with its own disclosure.
1. **Notifications** (NotificationListenerService).
   - Sort on the phone: bank and UPI alerts → `transaction` signals into Money's review queue (the same "review before it counts" rule the Gmail parser used); delivery updates → `package`; missed WhatsApp or regular calls → `missed_contact`; recruiter and job mail → Career.
   - Anything else stays raw on the phone, available to Ask.
2. **Calendar and contacts:** build `people`, find clashes.
3. **Calls.**
   - In `play`, through phone-state and missed-call notifications.
   - In `direct`, also from the call log: "3 missed calls from Mom", plus an after-call note prompt.
4. **Health Connect:** steps, sleep and heart rate replace the Apple Health export path for Android users.
5. **App usage** (UsageStatsManager): daily totals per app.
6. **Phone state:** battery, charging, Wi-Fi, headphones; location only as its own opt-in, coarse by default.

**Done when:** a week of real use on the owner's phone fills Money, Career and Today without manual entry, with no excluded item ever reaching the server. Check this with a test that seeds excluded apps and contacts.

### Phase 3: Doing
- **Ask Orbis tool calling:** a typed tool list, and the action runner on the phone.
- **The first actions:**
  - open an app
  - call
  - alarm, timer and reminder
  - Do Not Disturb (with notification-policy access)
  - torch
  - open the Wi-Fi, Bluetooth or other settings panel
  - navigate
  - add an expense
  - create a calendar event
  - reply from a notification
  - WhatsApp: open the chat with the text already typed
- **The confirm card** for anything outbound. An undo window where possible. Every action goes in the ledger.
- **On-phone command matching** for simple commands; Jev for command vs question.
- **Default digital assistant** registration and an Ask overlay that opens over any app.
- **Voice:** the existing voice path (Sarvam for Indian languages) plus Android's speech recogniser as a fallback.
- **Wake word "Hey Orbis"** (opt-in, microphone foreground service): train the model, measure false wakes and battery, ship behind a setting.

**Done when:** "Hey Orbis, tell Rahul I'm running late on WhatsApp" works hands-free up to the confirm tap, and "open YouTube" runs in under a second with no cloud call.

### Phase 4: Better answers
- **The memory layer:** pgvector embeddings of signals and journal entries, the `people` graph, a nightly summary per person, and facts with their sources.
  - Ask Orbis's context (`lib/ask/context.ts`, today five sources over 180 days) is rebuilt on top of memory search.
  - **First, extend the model registry** (`ai_providers`/`ai_models`, `lib/ai/router.ts`) with an embeddings task. Today the only embeddings code, `lib/health-docs/embeddings.ts`, calls OpenRouter directly and is marked as a known gap. Move it onto the router.
  - The embeddings model is the builder's choice. Use one the existing providers really offer, and don't invent an API.
- **Heads-ups v2:** promises spotted in chats, bills due, packages, unusual spending, calendar clashes, missed-call follow-ups. These extend `lib/headsups/checks/`.
- **Briefs:** a morning brief that includes overnight messages, a draft journal entry each evening, and a weekly review.
- **Questions about your phone:** "who did I talk to most this week", "what did the bank say yesterday".

### Phase 5: Advanced and store launch
- **Accessibility automation** in `direct`: "what's on my screen", multi-step tasks ("book the usual cab"), with a visible "Orbis is acting" overlay and a stop button.
- **Play launch:** Data safety form, permission declarations, prominent-disclosure screens, store listing, review response.
- **Paid plans:** plans and entitlements, Play Billing (RevenueCat or direct), and quotas read from the plan.

## 8. Testing

- **Web:** the existing Vitest and Playwright suites keep passing. New server endpoints get unit and e2e tests. Run e2e against staging only, because it creates real accounts.
- **Native:**
  - JUnit tests for the privacy rules engine (every exclusion), the masking rules, the sorting rules and sync batching.
  - Instrumented tests for the notification listener, using notifications posted by a test app.
- **Real phones:** at least one Samsung, one Xiaomi/Redmi and one Pixel. 48-hour survival and battery runs before each phase is called done.
- **Privacy regression test:** seed blocked apps, contacts and keywords and a paused window, then show that nothing from them appears in the local store, the server or any AI request.

## 9. Owner answers and owner actions

**Answered 2026-11-12:**
- **Privacy:** "by default + not by us". Nothing is read until the person turns it on. Raw phone data stays on the phone. Stored phone content is encrypted so people running Orbis can't browse it. Server-side AI may see masked text briefly to extract a fact or answer a question. True end-to-end encryption is out of scope.
- **Audience:** India first.
  - The on-phone sorting rules cover Indian banks, UPI apps, Indian delivery apps and WhatsApp at launch.
  - Voice keeps Sarvam for Indian languages.
  - The privacy policy, consent screens and Data safety form follow India's DPDP Act.
  - Phase 0 still makes time zone, currency and locale per person, so other countries need rules and legal work, not a rewrite.
- **Play account:** none yet. It's an owner step (below).

**Owner actions (the code can't do these):**
- **Create a Google Play developer account** at the start of Phase 1. Check whether Orbis's Money and Health features need an organisation account (which needs a D-U-N-S number) rather than a personal one, and pick that type if so.
  - A personal account must run a closed test with about 12 testers for 14 days before going public. Start it as soon as Phase 1's build is on the internal track, so the wait overlaps with Phase 2.
- **Create a Firebase / Google Cloud project** for FCM push and Google sign-in (Phase 0–1).
- **Create a staging Supabase project** and a Sentry project (Phase 0).
- **Test on real phones.** At the start of Phase 1, say which phones are available (make, model, Android version). Each phase's "Done when" includes owner-run steps on those phones: 48-hour survival, battery, and the Private Space / Secure Folder check. The plan writes these as explicit hand-off steps.
- **Review the legal text** (privacy policy, terms, DPDP consent wording) before Play submission.

## 10. Left to the builder

- Library versions (current stable Capacitor, Room, SQLCipher, ONNX Runtime, WorkManager), package names and module layout inside `android/`.
- Exact table columns, the signal type list and the sync batch sizes.
- The on-phone sorting rules for each bank and app, built from real samples.
- The UI of the privacy center and confirm card, within the existing design system. Keep the glow background and full-screen Ask on phones.
- Wake-word training data and thresholds.
