# Phase 1: Android shell, core service and privacy center — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Android app (Capacitor shell around the hosted Orbis site) with a native `orbis-core` that captures items through a privacy rules engine into an encrypted on-phone store and syncs derived signals to new, per-user-encrypted server tables, all controlled from a "What Orbis can see" privacy center, proven end to end with one test source.

**Architecture:** The WebView loads `https://orbis-starter.vercel.app`, so the UI keeps shipping through Vercel. The Kotlin library module `android/orbis-core` holds the rules engine, Room + SQLCipher store, ledger, sync worker and foreground service; the app module exposes it to the page through one Capacitor plugin, `OrbisCore`. The phone authenticates to `/api/device/*` with its own revocable device credential. Postgres `SECURITY DEFINER` functions check that credential, so no new service-role use is needed.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres, RLS), Vitest + `@electric-sql/pglite` for SQL tests, Capacitor (current stable major) for Android, Kotlin, Room, SQLCipher for Android (`net.zetetic:sqlcipher-android`), WorkManager, androidx.webkit, Firebase Cloud Messaging HTTP v1.

**Spec:** `docs/superpowers/specs/2026-11-12-android-agent-design.md` (§4 decisions, §6 privacy center, §7 Phase 1, §8 testing).

## Rulings that change the spec (record them in the ledger; the owner can overturn)

- **P1. Device credential, not shared Supabase tokens (replaces §4.9 and Phase 1's "hand over the session tokens" and "bearer-token context").**
  - Supabase refresh tokens are single-use. If the WebView and `orbis-core` each refreshed the same session, reuse detection would revoke it and sign the person out.
  - Instead, the signed-in page calls `POST /api/device/register` with its cookie, receives `{deviceId, secret}` once, and hands both to `OrbisCore`.
  - The phone sends `Authorization: Device <deviceId>.<secret>`. The server stores only the SHA-256 of the secret.
  - The `api` branch's bearer context is not ported in Phase 1.
- **P2. Biometric unlock is the existing passkey unlock, made to work inside the WebView.** This needs androidx.webkit WebAuthn support plus the `get_login_creds` relation in `assetlinks.json`. No new server cryptography.
- **P3. The phone is the authority for privacy rules.**
  - Blocked apps, contacts and keywords never leave the phone.
  - The server keeps only each phone's source on/off state, and refuses signals from a source that phone reports as off.
- **P4. A `test` source ships in every Phase 1 build** (it is the end-to-end proof). Phase 2 removes it from the UI.
- **P5. `applicationId` is `app.orbis.android` as a placeholder.** It becomes permanent on the first Play upload, so it is an owner decision before then (owner hand-off, Task 14).

## Global Constraints

- Read the relevant guide in `node_modules/next/dist/docs/` before writing Next code (AGENTS.md). Route handlers are `app/**/route.ts`.
- Unit tests: `lib/**/*.test.ts`, Vitest, `node:assert/strict`. Run `pnpm exec vitest run`, `pnpm exec tsc --noEmit`, `pnpm lint`.
- Kotlin tests:
  - JVM unit tests: `android/orbis-core/src/test`, run with `cd android && ./gradlew :orbis-core:testDebugUnitTest`.
  - Instrumented tests: `src/androidTest`, run with `./gradlew :orbis-core:connectedDebugAndroidTest` on an emulator.
  - Environment: JDK `F:\dev\jdk-21`, Android SDK `F:\dev\android-sdk` (platforms 34–36).
- The repo is public: no secrets, keystores, `google-services.json` or service-account JSON in git.
- Never run Playwright against production. `.env.local` is production.
- **Nothing is read by default:** every source starts off.
- **An excluded item is never written anywhere:**
  - not to the raw store, not to the outbox, not to the server;
  - its ledger row carries only source, time, decision and reason;
  - it carries no package name, contact or text.
- Raw text stays on the phone. Server signal `content` is stored only as a per-user AES-GCM envelope.
- The `play` flavour's merged manifest must never contain `READ_SMS`, `READ_CALL_LOG`, `BIND_ACCESSIBILITY_SERVICE`, `QUERY_ALL_PACKAGES` or `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`. Direct-only permissions go in `android/app/src/direct/AndroidManifest.xml`.
- Source wire names, exactly: `test`, `notifications`, `calendar`, `contacts`, `calls`, `health`, `usage`, `phone_state`, `location`.
- Limits, exactly:
  - 100 signals per sync request, 4,000 characters of signal content, 256 KB per request body;
  - 10 active phones per account;
  - 30-day raw retention, 90-day ledger retention, 5,000-item outbox cap.
- No new `createAdminClient` import. `lib/security/admin-usage.test.ts` must stay green unchanged, apart from the doc row Task 5 updates.
- UI copy is plain, short English in the existing voice. Keep the glow background and the existing settings design (`pf-group st-group` sections).
- New env vars go in `.env.example` with a comment:
  - `ORBIS_PHONE_DATA_KEY` (base64 32 bytes)
  - `FCM_SERVICE_ACCOUNT` (base64 of the service-account JSON)
  - `ANDROID_APP_ID`
  - `ANDROID_CERT_SHA256` (comma-separated)

## Review Focus

1. **The site's CSP blocks Capacitor's injected bridge.** The CSP is nonce + `'strict-dynamic'`. If it blocks the bridge, `window.Capacitor` is missing and every `OrbisCore` call silently fails. Expected: the bridge is present on the hosted page. Pinned by Task 6 Step 6.
2. **A different person signs in on the same phone.** Expected: the previous person's raw items, outbox, ledger and device credential are wiped before the new person's phone registers. Pinned by Task 8 Step 6 (wipe test) and Task 12 Step 1 (`shouldResetDevice` test).
3. **Indian bank, UPI and OTP texts.** Expected: codes, card numbers and long reference or phone numbers are masked; amounts with commas, dates and `XX1234` stay readable. Pinned by Task 7 Step 1 samples.
4. **A phone removed from the web while it was offline.** Expected: its next sync gets 401, then it wipes local data, stops the service and shows "signed out". Pinned by Task 2 (revoked → null) and Task 9 Step 1 (401 → `Revoked`).
5. **A batch retried after a timeout.** Expected: it is stored once and counted as duplicates, not new rows. Pinned by Task 2 Step 1 (resend test).

---

### Task 1: Per-user encryption for phone data

**Files:** Create `lib/crypto/user-keys.ts`, `lib/crypto/user-keys.test.ts`

**Interfaces:**
- Produces:
  - `class PhoneDataCryptoError extends Error`
  - `phoneDataReady(env?): boolean`
  - `encryptForUser(userId: string, plaintext: string, context: string): string`
  - `decryptForUser(userId: string, envelope: string, context: string): string`

- [ ] **Step 1: Write failing tests.** Set `ORBIS_PHONE_DATA_KEY` to a fixed base64 32-byte value in the test. Assert:
  - The round trip returns the plaintext, and the envelope matches `/^p1\.[\w-]+\.[\w-]+\.[\w-]+$/`.
  - Two encryptions of the same text differ.
  - Decrypting with a different `userId` throws `PhoneDataCryptoError`.
  - Decrypting with a different `context` throws.
  - A tampered last character throws.
  - With the key unset, or 16 bytes long, `phoneDataReady()` is false and `encryptForUser` throws `PhoneDataCryptoError`.
- [ ] **Step 2: Run** `pnpm exec vitest run lib/crypto/user-keys.test.ts`. Expect FAIL (module missing).
- [ ] **Step 3: Implement.**
  - Key: `hkdfSync('sha256', master, 'orbis-phone-data-v1', 'user:' + userId, 32)`.
  - Cipher: AES-256-GCM with a 12-byte nonce.
  - AAD: `userId + '\n' + context`.
  - Envelope: `p1.<nonce>.<tag>.<ciphertext>`, each part base64url.
  - Follow the structure and error style of `lib/crypto/credentials.ts`, and add `import 'server-only'`.
- [ ] **Step 4: Run** the test again. Expect PASS.
- [ ] **Step 5: Commit** `Add per-user encryption for phone data`.

### Task 2: Device tables and functions, tested with PGlite

**Files:**
- Create `supabase/migrations/202611120004_devices.sql`.
- Create `lib/device/sql-harness.ts`, a test helper that boots PGlite with stubs for `auth.users`, `auth.uid()` and the roles `anon` and `authenticated`, then loads the migration.
- Create `lib/device/schema.test.ts`.
- Modify `package.json` to add the devDependency `@electric-sql/pglite`, at the current stable version.

**Interfaces:**
- Produces these tables, all with RLS enabled:
  - `devices(id uuid pk default gen_random_uuid(), user_id uuid not null → auth.users on delete cascade, name text 1–60, platform text default 'android' check ('android'), flavour text check in ('play','direct'), app_version text ≤20, secret_hash text check ~ '^[0-9a-f]{64}$', push_token text ≤4096, created_at, last_seen_at, revoked_at)`
  - `device_sources(device_id → devices on delete cascade, user_id → auth.users on delete cascade, source text, enabled bool, updated_at, pk(device_id, source))`
  - `signals(user_id → auth.users on delete cascade, id uuid, device_id → devices on delete set null, source text, kind text check ~ '^[a-z][a-z_]{0,39}$', occurred_at timestamptz, content text ≤20000, created_at, pk(user_id, id))`
  - `activity_ledger(device_id → devices on delete cascade, user_id, day date, source, kept/dropped/actions int ≥0, updated_at, pk(device_id, day, source))`
  - `source` on every table is checked against the Global Constraints list.
- Produces these policies and grants:
  - `devices`:
    - select, insert and update own (`user_id = auth.uid()`);
    - authenticated may select every column except `secret_hash` and `push_token` (column grants);
    - authenticated may update only `name` and `revoked_at`;
    - an insert must have `revoked_at is null`.
  - `device_sources`: select own, update `enabled` own.
  - `signals` and `activity_ledger`: select and delete own.
  - No insert grant to `authenticated` or `anon` on `device_sources`, `signals` or `activity_ledger`.
- Produces these functions, all `security definer` with `set search_path = ''`, executable by `anon` and `authenticated`, revoked from `public`:
  - `public.device_whoami(p_device uuid, p_secret text) returns uuid`:
    - returns `user_id` when `encode(sha256(convert_to(p_secret,'UTF8')),'hex') = secret_hash` and `revoked_at is null`;
    - otherwise returns null.
  - `public.device_sync(p_device uuid, p_secret text, p_meta jsonb, p_sources jsonb, p_signals jsonb, p_ledger jsonb) returns jsonb`. On an unverified device it returns null. Otherwise, in order:
    1. raise `too_many_signals` if there are more than 100 signals;
    2. update `last_seen_at`, `app_version` (if given) and `push_token` (only if the `pushToken` key is present; an empty string sets null);
    3. upsert `p_sources` (`[{source, enabled}]`);
    4. insert each `p_signals` item (`{id, source, kind, occurredAt, content}`) only if its source is enabled for this device, `on conflict do nothing`;
    5. upsert `p_ledger` (`[{day, source, kept, dropped, actions}]`), replacing the counts;
    6. return `{"accepted":n,"duplicate":n,"refused":n}`.
  - `public.device_revoke(p_device uuid, p_secret text) returns boolean`: sets `revoked_at` and returns true; returns false when the device isn't verified.

- [ ] **Step 1: Write failing tests** in `lib/device/schema.test.ts`. Each test gets a fresh PGlite instance with users A and B and a device for A with secret `s3cret`, inserted as A. Tests:
  - `whoami returns A's id for the right secret and null for a wrong one`.
  - `sync stores a signal from an enabled source and refuses one from a disabled source`. Expect `{accepted:1, duplicate:0, refused:1}`.
  - `resending the same batch counts duplicates and stores nothing new`. Expect `{accepted:0, duplicate:1, refused:0}` and a row count of 1.
  - `sync with 101 signals raises too_many_signals`.
  - `ledger upsert replaces counts for the same day and source`.
  - `a revoked device: revoke returns true, then whoami and sync return null`.
  - `as B (set role authenticated, auth.uid = B), A's signals, devices and ledger are invisible`.
  - `as A, selecting secret_hash from devices is denied`.
  - `as anon, selecting from devices and signals returns nothing or is denied`.
  - `deleting user A removes A's devices, sources, signals and ledger`.
- [ ] **Step 2: Run** `pnpm exec vitest run lib/device/schema.test.ts`. Expect FAIL (no migration).
- [ ] **Step 3: Write the migration and the harness.**
  - Make the migration safe to re-run in the Phase 0 style: `create table if not exists`, and `drop policy if exists` before each `create policy`.
  - If PGlite can't run something the migration needs, change the harness stubs, never the migration.
- [ ] **Step 4: Run** the test again. Expect PASS. Also run the full `pnpm exec vitest run`.
- [ ] **Step 5: Commit** `Add device, source, signal and ledger tables with device-credential functions`.

### Task 3: Device request rules (pure)

**Files:**
- Create `lib/device/http.ts` and `lib/device/http.test.ts`.
- Create `tests/fixtures/device-sync.json`. Task 9 reuses this file as the Kotlin–TypeScript contract.

**Interfaces:**
- Produces:
  - `SOURCES` (readonly tuple of the wire names) and `type Source`
  - `MAX_SIGNALS = 100`, `MAX_CONTENT_CHARS = 4000`, `MAX_BODY_BYTES = 256 * 1024`, `MAX_ACTIVE_DEVICES = 10`
  - `deviceCredential(header: string | null): { deviceId: string; secret: string } | null`: accepts only `Device <uuid>.<43 base64url chars>`
  - `newDeviceSecret(): string` (32 random bytes, base64url, 43 characters)
  - `secretHash(secret: string): string` (SHA-256, lowercase hex)
  - `parseRegister(text: string): { name: string; flavour: 'play' | 'direct'; appVersion: string } | string`
  - `parseSync(text: string, now: Date): SyncInput | string`, where `SyncInput = { meta: { appVersion?: string; pushToken?: string }; sources: { source: Source; enabled: boolean }[]; signals: { id: string; source: Source; kind: string; occurredAt: string; content: string }[]; ledger: { day: string; source: Source; kept: number; dropped: number; actions: number }[] }`

- [ ] **Step 1: Write failing tests.**
  - `deviceCredential` rejects:
    - a `Bearer` header;
    - a missing dot;
    - a non-UUID id;
    - a 42-character secret.
  - `deviceCredential` accepts a valid header and returns its parts.
  - `secretHash('s3cret')` equals Postgres's `encode(sha256('s3cret'),'hex')`. Hard-code the hex literal. Task 2's harness inserts devices with `createHash('sha256')`, and this literal pins the two together.
  - `newDeviceSecret()` matches `/^[\w-]{43}$/`.
  - `parseRegister` trims the name, cuts it to 60 characters, and rejects an unknown flavour.
  - `parseSync` accepts the fixture file and returns it unchanged.
  - `parseSync` rejects each of these:
    - 101 signals;
    - content of 4,001 characters;
    - an unknown source;
    - a non-UUID id;
    - `occurredAt` more than 1 day in the future or more than 400 days in the past;
    - a ledger `day` that isn't `YYYY-MM-DD`;
    - a negative count;
    - invalid JSON.
  - Each rejection returns a string.
- [ ] **Step 2: Run** the tests. Expect FAIL.
- [ ] **Step 3: Implement** `lib/device/http.ts`, and write the fixture: 2 signals (source `test`, kind `test_item`), 1 source, 1 ledger row, and meta with `appVersion` and `pushToken`.
- [ ] **Step 4: Run** the tests. Expect PASS.
- [ ] **Step 5: Commit** `Add device request parsing and the sync contract fixture`.

### Task 4: `/api/device/register`, `/api/device/signals`, `/api/device/revoke`, and export

**Files:**
- Create:
  - `lib/device/service.ts` and `lib/device/service.test.ts`
  - `lib/device/client.ts`, a sessionless Supabase client using the publishable key, no cookies, no session persistence
  - `app/api/device/register/route.ts`, `app/api/device/signals/route.ts`, `app/api/device/revoke/route.ts`
- Modify:
  - `lib/account/deletion-plan.ts` and its test: add the export tables; widen `ExportTable.columns` to `'*' | string`, with `devices` listing every column except `secret_hash` and `push_token`.
  - `app/api/account/export/route.ts`: decrypt `signals.content` with `decryptForUser(userId, content, id)`. If `phoneDataReady()` is false, export the ciphertext and add a note.

**Interfaces:**
- Consumes: Task 1's crypto functions, Task 2's RPCs, and Task 3's parsers.
- Produces:
  - `syncDevice(deps: { whoami(id, secret): Promise<string | null>; sync(args): Promise<SyncResult | null>; ready(): boolean; encrypt(userId, text, context): string }, authHeader: string | null, body: string, now: Date): Promise<{ status: number; body: unknown }>`
  - `revokeWithCredential(deps: { revoke(id, secret): Promise<boolean> }, authHeader: string | null): Promise<{ status: number }>`

- [ ] **Step 1: Write failing tests** for `service.ts`:
  - A bad header gives 401.
  - Key not ready gives 503 with `{error:'Phone sync is not set up on the server yet.'}`.
  - A parse error gives 400 with the parser's message.
  - `whoami` returning null gives 401.
  - The `sync` spy receives `content` values that start with `p1.` and never equal the plaintext; `encrypt` receives `context === signal.id`.
  - `sync` returning null gives 401.
  - Success gives 200 with the RPC result.
  - `revokeWithCredential` gives 204, or 401 when `revoke` returns false.
- [ ] **Step 2: Run** the tests. Expect FAIL.
- [ ] **Step 3: Implement the service and the three routes.** Before writing them, read the route-handler doc in `node_modules/next/dist/docs/`.
  - **`register`:**
    - Accepts POST only.
    - Applies the same signed-in, app-unlocked and same-origin checks the app's existing cookie POST routes use; follow `app/api/home/career/route.ts` and `lib/security/fetch-metadata.ts`.
    - Rate limit: 10 per hour per person, via `lib/security/rate-limit`.
    - If the person already has 10 devices with `revoked_at is null`, answer 409 with `You have 10 phones signed in. Remove one in Settings → What Orbis can see.`
    - Otherwise insert `{name, flavour, app_version, secret_hash: secretHash(secret)}` through the cookie client and answer 201 `{deviceId, secret}` with `cache-control: no-store`.
  - **`signals`:** POST; `syncDevice` wired to `lib/device/client.ts` RPCs. Refuse a body over `MAX_BODY_BYTES` with 413.
  - **`revoke`:**
    - With a `Device` header, use `revokeWithCredential`.
    - Otherwise, with a cookie session and the same checks as register, body `{deviceId}`: set `revoked_at = now()` through the cookie client, then answer 204.
  - Confirm `proxy.ts` neither redirects nor rejects header-less POSTs to `/api/device/*`.
- [ ] **Step 4: Run** `pnpm exec vitest run`, `pnpm exec tsc --noEmit` and `pnpm lint`. All must pass.
- [ ] **Step 5: Commit** `Add device register, sync and revoke endpoints, and include phone data in export`.

### Task 5: `assetlinks.json` and native push through FCM

**Files:**
- Create:
  - `lib/native/assetlinks.ts` and its test
  - `app/.well-known/assetlinks.json/route.ts`
  - `lib/notifications/fcm.ts` and `lib/notifications/fcm.test.ts`
- Modify:
  - `lib/notifications/push.ts`
  - `docs/security/service-role-uses.md`, the `push.ts` row: it also reads `devices.push_token` and clears it for this person's own devices
  - `.env.example`

**Interfaces:**
- Produces:
  - `assetLinks(appId: string | undefined, fingerprints: string | undefined): object[]`
  - `fcmConfigured(env?): boolean`
  - `fcmJwtClaims(sa: { client_email: string }, nowSec: number): object`
  - `fcmMessage(token: string, payload: PushPayload): object`
  - `fcmOutcome(status: number, body: unknown): 'sent' | 'gone' | 'failed'`
  - `sendFcm(token: string, payload: PushPayload): Promise<'sent' | 'gone' | 'failed'>`

- [ ] **Step 1: Write failing tests.**
  - `assetLinks`:
    - returns `[]` when either input is unset or a fingerprint isn't 32 colon-separated hex pairs;
    - otherwise returns one statement with relations `delegate_permission/common.handle_all_urls` and `delegate_permission/common.get_login_creds`, `target: {namespace:'android_app', package_name, sha256_cert_fingerprints}`, with fingerprints upper-cased.
  - `fcmJwtClaims` returns:
    - `iss` = the client email;
    - `scope` = `https://www.googleapis.com/auth/firebase.messaging`;
    - `aud` = `https://oauth2.googleapis.com/token`;
    - `exp` = `iat + 3600`.
  - `fcmMessage` sets `message.token`, `notification.{title,body}`, `android.priority='high'`, `android.notification.channel_id='orbis'`, `android.notification.tag=payload.tag` and `data.url=payload.url`.
  - `fcmOutcome`: 200 gives `'sent'`; 404, or a body with `error.details[].errorCode==='UNREGISTERED'`, gives `'gone'`; anything else gives `'failed'`.
- [ ] **Step 2: Run** the tests. Expect FAIL.
- [ ] **Step 3: Implement.**
  - `sendFcm`:
    - Reads `FCM_SERVICE_ACCOUNT` (base64 of the JSON).
    - Signs an RS256 JWT with `node:crypto`'s `createSign` and exchanges it at the token endpoint. Cache the access token until 60 seconds before it expires.
    - POSTs to `https://fcm.googleapis.com/v1/projects/{project_id}/messages:send`.
    - Times out after 5 s, matching `PUSH_TIMEOUT_MS`.
  - `pushToUser`:
    - Also selects `devices` with `user_id = userId`, `push_token is not null` and `revoked_at is null`.
    - Sends with bounded concurrency, the same as web push.
    - A `'gone'` result sets that device's `push_token = null`.
    - FCM devices count in `devices` and `sent`.
  - The route returns `assetLinks(process.env.ANDROID_APP_ID, process.env.ANDROID_CERT_SHA256)` as `application/json` with `cache-control: public, max-age=3600`.
- [ ] **Step 4: Run** all unit tests, then `pnpm exec tsc --noEmit` and `pnpm lint`. All must pass.
- [ ] **Step 5: Commit** `Serve assetlinks.json and send native push through FCM`.

### Task 6: Capacitor Android shell

**Files:**
- Create:
  - `capacitor.config.ts`
  - `native/www/index.html`, a minimal page that never shows in remote mode
  - `native/www/offline.html`, styled with `#0E0E10` and the Orbis mark: "Orbis can't reach the internet. It will reload when you're back online." It retries every 10 s
  - `android/`, generated by `npx cap add android`
  - `android/app/src/direct/AndroidManifest.xml`, empty of permissions for now
  - `lib/native/manifest.test.ts`
  - `.vercelignore`, listing `android/` and `native/`
- Modify:
  - `package.json`: add `@capacitor/core`, `@capacitor/android`, `@capacitor/push-notifications`, and the devDependencies `@capacitor/cli` and `@capacitor/assets`, all the same current stable major, pinned exactly
  - the ESLint config and `tsconfig.json`: exclude `android/` and `native/`
  - `.gitignore`: add `android/app/google-services.json`, `*.jks`, `*.keystore`, and `android/**/build/`

**Interfaces:**
- Produces:
  - `capacitor.config.ts` with:
    - `appId: 'app.orbis.android'`, `appName: 'Orbis'`, `webDir: 'native/www'`;
    - `server: { url: process.env.ORBIS_URL ?? 'https://orbis-starter.vercel.app', errorPath: 'offline.html' }`;
    - `android: { appendUserAgent: 'OrbisAndroid' }`.
  - Gradle `flavorDimensions 'distribution'` with `play` and `direct` (`versionNameSuffix '-direct'`), and `buildConfigField String DISTRIBUTION`.
  - Notification channel `orbis` ("Orbis", default importance), created in the app's `Application` class.

- [ ] **Step 1: Write a failing test,** `lib/native/manifest.test.ts`. It reads `android/app/src/main/AndroidManifest.xml`, `android/app/src/play/AndroidManifest.xml` (if present) and `android/orbis-core/src/main/AndroidManifest.xml` (if present), and asserts that none contains a Global Constraints forbidden permission. It also asserts that `capacitor.config.ts` contains `appendUserAgent: 'OrbisAndroid'`. It fails now because `android/` is missing.
- [ ] **Step 2: Generate and configure the shell.**
  - Install the packages, then `npx cap add android` and `npx cap sync android`.
  - Check `server.errorPath` exists in `node_modules/@capacitor/cli/dist/declarations.d.ts`. If it doesn't, load `offline.html` from `onReceivedError` for the main frame in a `BridgeWebViewClient` subclass.
  - Generate the icon and splash with `npx @capacitor/assets generate --android`, from the largest PNG in `public/icons/`, on background `#0E0E10`.
  - Add the flavours to the build file.
- [ ] **Step 3: Enable WebAuthn and debugging in `MainActivity`.**
  - After `super.onCreate`, if `WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)`, call `WebSettingsCompat.setWebAuthenticationSupport(bridge.webView.settings, WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP)`, with the current stable `androidx.webkit`.
  - If this API doesn't exist in the current androidx.webkit, stop and report BLOCKED. Don't build a substitute.
  - In debug builds, call `WebView.setWebContentsDebuggingEnabled(true)`.
- [ ] **Step 4: Build both flavours.** Run `cd android && ./gradlew assemblePlayDebug assembleDirectDebug` and expect BUILD SUCCESSFUL. Then grep `app/build/intermediates/merged_manifests/playDebug/**/AndroidManifest.xml` for each forbidden permission and expect no matches.
- [ ] **Step 5: Run** `pnpm exec vitest run lib/native/manifest.test.ts`. Expect PASS.
- [ ] **Step 6: Check the bridge on an emulator** (Review Focus 1).
  - Create an AVD from an installed system image if none exists, boot it headless, and install `playDebug`.
  - Attach to the WebView's DevTools socket (`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`) and use a small Node CDP script in the scratchpad.
  - Evaluate `!!window.Capacitor?.isNativePlatform?.()` on the loaded production page. Expect `true`, with no CSP violation for the bridge in the console.
  - If CSP blocks it: in `proxy.ts`, when the user agent contains `OrbisAndroid`, add the bridge script's `'sha256-…'` hash to `script-src` (still nonce + `'strict-dynamic'`), with a `lib/security/csp.test.ts` case. Then repeat this step.
  - Also check that following a link to `https://example.com` opens outside the app.
- [ ] **Step 7: Commit** `Add the Capacitor Android shell with play and direct flavours`.

### Task 7: `orbis-core` privacy rules and masking (pure Kotlin)

**Files:**
- Create `android/orbis-core/`: a Gradle library module included in `android/settings.gradle` and depended on by `:app`, with package `app.orbis.core`.
- Create `rules/Source.kt`, `PrivacySettings.kt`, `CapturedItem.kt`, `Decision.kt`, `PrivacyRules.kt`, `Masking.kt` and `DefaultBlocklist.kt`.
- Tests: `src/test/.../PrivacyRulesTest.kt` and `MaskingTest.kt`.

**Interfaces:**
- Produces:
  - `enum class Source(val wire: String)`, with the 9 wire names; `Source.fromWire(s): Source?`
  - `data class PrivacySettings(val enabled: Set<Source> = emptySet(), val blockedPackages: Set<String> = DefaultBlocklist.PACKAGES, val blockedContacts: Set<String> = emptySet(), val blockedKeywords: List<String> = emptyList(), val pausedUntil: Long? = null)`. `pausedUntil` is epoch milliseconds; `PAUSED_FOREVER = Long.MAX_VALUE`.
  - `data class CapturedItem(val source: Source, val packageName: String?, val contacts: List<String>, val text: String, val occurredAt: Long, val fromOtherProfile: Boolean = false)`
  - `sealed interface Decision { data class Keep(val maskedText: String); data class Drop(val reason: DropReason) }`
  - `enum class DropReason { OTHER_PROFILE, PAUSED, SOURCE_OFF, BLOCKED_APP, BLOCKED_CONTACT, BLOCKED_KEYWORD }`
  - `object PrivacyRules { fun decide(item: CapturedItem, settings: PrivacySettings, now: Long): Decision; fun contactKey(raw: String): String }`. Checks run in the `DropReason` order above. `contactKey`: 7 or more digits gives the last 10 digits; otherwise lowercase, trimmed, with spaces collapsed.
  - `object Masking { fun mask(text: String): String }`

- [ ] **Step 1: Write failing tests.**
  - `MaskingTest`, input to expected output exactly:
    - `Your OTP for login is 482913. Do not share.` → `Your OTP for login is [code]. Do not share.`
    - `Your verification code is 1234` → `Your verification code is [code]`
    - `Rs.1,250.00 debited from A/c XX1234 on 12-11-26. UPI Ref 431298765012.` → `Rs.1,250.00 debited from A/c XX1234 on 12-11-26. UPI Ref ••••5012.`
    - `Card 4111 1111 1111 1111 used` → `Card ••••1111 used`
    - `Call me on 98765 43210` → `Call me on ••••3210`
    - `password: hunter2` → `password [hidden]`
    - `Order 1234 shipped`, `Meeting at 10:30 on 12/11/2026` and `₹1,00,000 credited` are unchanged.
  - `PrivacyRulesTest`:
    - default settings drop with `SOURCE_OFF`;
    - each `DropReason` on its own;
    - `OTHER_PROFILE` wins over `PAUSED`;
    - `PAUSED_FOREVER` drops;
    - an expired pause keeps;
    - blocked contact `+91 98765-43210` matches the item contact `9876543210`;
    - a keyword matches regardless of case, in text and in contact names;
    - `Keep.maskedText` is masked;
    - `DefaultBlocklist.PACKAGES` contains `com.google.android.apps.authenticator2`.
- [ ] **Step 2: Run** `cd android && ./gradlew :orbis-core:testDebugUnitTest`. Expect FAIL.
- [ ] **Step 3: Implement.**
  - Masking rules, in order:
    1. `(password|passwd|pwd|pin|cvv)\s*(is|:|=)?\s*\S+` (ignore case) becomes `<word> [hidden]`.
    2. If the text contains `otp|one[- ]time|verification|passcode|security code|code` (ignore case), each standalone 4–8 digit number becomes `[code]`.
    3. Each run of 9 or more digits, allowing single spaces or hyphens between groups, becomes `••••` plus its last 4 digits.
  - `DefaultBlocklist.PACKAGES`:
    - authenticators and password managers: `com.google.android.apps.authenticator2`, `com.azure.authenticator`, `com.authy.authy`, `com.x8bit.bitwarden`, `com.agilebits.onepassword`, `com.lastpass.lpandroid`, `com.dashlane`, `com.callpod.android_apps.keeper`;
    - Indian banking apps: `com.sbi.lotusintouch`, `com.csam.icici.bank.imobile`, `com.axis.mobile`, `com.msf.kbank.mobile`, plus HDFC Bank's current app;
    - confirm each ID resolves at `https://play.google.com/store/apps/details?id=<id>`, and drop or replace any that don't.
- [ ] **Step 4: Run** the tests. Expect PASS.
- [ ] **Step 5: Commit** `Add the orbis-core privacy rules engine and masking`.

### Task 8: Encrypted on-phone store and capture pipeline

**Files:**
- Create in `android/orbis-core/src/main/java/app/orbis/core/store/`:
  - `OrbisDatabase.kt`
  - entities and DAOs for `RawItem`, `PendingSignal`, `LedgerEntry` and `Kv`
  - `KeyManager.kt`: an Android Keystore AES key wraps a random 32-byte SQLCipher passphrase, stored in SharedPreferences
  - `OrbisStore.kt`, `CapturePipeline.kt` and `StorePort.kt`
- Tests: `src/test/.../CapturePipelineTest.kt` (a fake `StorePort`) and `src/androidTest/.../OrbisStoreTest.kt`.

**Interfaces:**
- Consumes: Task 7's types.
- Produces:
  - `interface StorePort`, the DAO surface `CapturePipeline` needs, so it can be faked on the JVM.
  - `class CapturePipeline(port: StorePort) { suspend fun capture(item: CapturedItem, settings: PrivacySettings, now: Long): Decision }`:
    - On Keep, write a `RawItem` (masked text, package, contact keys) and a `PendingSignal` (`UUID` id, source, kind `test_item` for `Source.TEST`, `occurredAt`, content = masked text cut to 4,000 characters), and bump the ledger.
    - On Drop, write only `LedgerEntry(at, source, decision='dropped', reason)`.
  - `class OrbisStore(context)` exposing:
    - `capture`
    - `settings(): PrivacySettings` and `saveSettings`
    - `setSourceEnabled(source, on)`: turning a source off deletes its `RawItem` and `PendingSignal` rows
    - `pause(until: Long?)`
    - `pendingBatch(limit: Int): List<PendingSignal>` and `markSynced(ids)`
    - `ledgerDays(): List<LedgerDay(day, source, kept, dropped, actions)>`, using the phone's local day
    - `recentActivity(limit)`
    - `prune(now)`: raw items older than 30 days, ledger older than 90 days, and the outbox beyond its 5,000 newest
    - `credential(): DeviceCredential?`, `saveCredential(DeviceCredential(deviceId, secret, userId, serverUrl))` and `clearCredential()`
    - `lastSync` read and write
    - `wipe()`: deletes every table, the credential and settings back to defaults

- [ ] **Step 1: Write the failing JVM test** `CapturePipelineTest`, which includes the spec §8 privacy regression test.
  - Seed a blocked app, a blocked contact, a blocked keyword, a disabled source, a pause window and an other-profile item.
  - Feed one item for each case plus one allowed item.
  - Assert the fake holds exactly 1 raw item and 1 pending signal: the allowed one, masked.
  - Assert no stored field anywhere contains the blocked package, contact, keyword or text.
  - Assert the ledger has 7 rows, and the dropped rows carry only source, time and reason.
- [ ] **Step 2: Run** `./gradlew :orbis-core:testDebugUnitTest`. Expect FAIL.
- [ ] **Step 3: Implement the store.** Use SQLCipher through `SupportOpenHelperFactory`, with versions from `net.zetetic:sqlcipher-android`'s current README. Use KSP for Room.
- [ ] **Step 4: Run** the JVM tests. Expect PASS.
- [ ] **Step 5: Write and run the instrumented `OrbisStoreTest`** on the emulator:
  - A capture survives closing and reopening the store.
  - The database file's first 16 bytes are not `SQLite format 3\0`.
  - `setSourceEnabled(TEST,false)` removes the test items.
- [ ] **Step 6:** In the same test, check `wipe()` leaves zero rows in every table and a null credential (Review Focus 2). Run `./gradlew :orbis-core:connectedDebugAndroidTest`. Expect PASS.
- [ ] **Step 7: Commit** `Add the encrypted on-phone store and capture pipeline`.

### Task 9: Sync worker

**Files:**
- Create in `android/orbis-core/src/main/java/app/orbis/core/sync/`: `SyncPayload.kt`, `SyncPlanner.kt`, `SyncClient.kt`, `SyncOutcome.kt`, `SyncWorker.kt` and `SyncScheduler.kt`.
- Tests: `src/test/.../SyncPayloadTest.kt`, `SyncPlannerTest.kt` and `SyncOutcomeTest.kt`.

**Interfaces:**
- Consumes: `OrbisStore` (Task 8), the endpoint and contract (Tasks 3 and 4).
- Produces:
  - `SyncPayload.toJson(meta, sources, signals, ledger): String`
  - `SyncPlanner.batches(pending: List<PendingSignal>, maxCount: Int = 100, maxBytes: Int = 200_000): List<List<PendingSignal>>`
  - `sealed SyncOutcome { Done; Revoked; Retry }` with `SyncOutcome.from(httpStatus: Int)`: 2xx is `Done`; 401 and 403 are `Revoked`; 400 and 413 are `Done` (log it and drop the batch, so a bad item can't wedge the queue); everything else is `Retry`.
  - `SyncScheduler.ensurePeriodic(context)`: unique periodic work `orbis-sync`, every 15 minutes, `CONNECTED` constraint, `KEEP`.
  - `SyncScheduler.now(context)`: unique one-time work `orbis-sync-now`, `REPLACE`.

- [ ] **Step 1: Write failing tests.**
  - `SyncPayloadTest`: serialising the objects behind `tests/fixtures/device-sync.json` (read from `../../tests/fixtures` relative to `android/`) gives JSON equal to the fixture, compared as parsed trees.
  - `SyncPlannerTest`: 250 items give batches of 100, 100 and 50; items over the byte cap split earlier; an empty list gives no batches.
  - `SyncOutcomeTest`: 200, 401, 403, 400, 429, 500 and 503 each map as specified.
- [ ] **Step 2: Run** the tests. Expect FAIL.
- [ ] **Step 3: Implement.**
  - `SyncWorker` (`CoroutineWorker`):
    - With no credential, return success.
    - Run `prune(now)`, then post up to 5 batches. If there are no pending signals, still post one request with empty `signals`, so sources, ledger and meta still sync.
    - `Done` calls `markSynced(batch ids)`.
    - `Revoked` calls `store.wipe()`, stores `signedOutReason='revoked'` in `Kv`, calls `CoreHooks.onRevoked(context)` and returns success.
    - `CoreHooks` is an `object` with a settable `onRevoked: (Context) -> Unit`, a no-op until Task 10 points it at `CoreController.reconcile`.
    - `Retry` returns `Result.retry()`, with exponential backoff starting at 30 s.
  - `SyncClient` uses `HttpURLConnection` with 15 s timeouts, posting to `credential.serverUrl + '/api/device/signals'` with `Authorization: Device <id>.<secret>`.
- [ ] **Step 4: Run** the tests. Expect PASS.
- [ ] **Step 5: Commit** `Add the WorkManager sync worker`.

### Task 10: Foreground service, boot and battery

**Files:**
- Create `android/orbis-core/src/main/java/app/orbis/core/service/`: `CoreService.kt`, `CoreController.kt`, `ServicePolicy.kt` and `BootReceiver.kt`.
- Create `orbis-core`'s `AndroidManifest.xml`.
- Test: `src/test/.../ServicePolicyTest.kt`.

**Interfaces:**
- Produces:
  - `ServicePolicy.shouldRun(settings: PrivacySettings, now: Long, hasCredential: Boolean): Boolean`: true only with a credential, at least one enabled source, and not paused.
  - `CoreController.reconcile(context)`:
    - starts or stops `CoreService`;
    - ensures the periodic sync;
    - when paused until a finite time, enqueues unique one-time work `orbis-resume` delayed to that time, which calls `reconcile`.
  - `CoreController.batteryOptimized(context): Boolean`
  - `CoreController.openBatterySettings(activity)`:
    - `direct`: `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` with `package:` URI;
    - `play`: `ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS`.
  - `CoreController.openAppInfo(activity)`

- [ ] **Step 1: Write the failing test** `ServicePolicyTest`: no credential gives false; no sources gives false; paused gives false; a pause in the past gives true; one source with a credential gives true.
- [ ] **Step 2: Run** the test. Expect FAIL.
- [ ] **Step 3: Implement.**
  - Service:
    - `foregroundServiceType="specialUse"` with `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` = "Personal assistant that applies the user's privacy rules to the phone data they chose to share".
    - Permissions `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_SPECIAL_USE`.
    - Notification channel `orbis_active` at low importance, ongoing. Title "Orbis is active"; text "Reading: Test source", listing the enabled source labels. Tapping it opens the app.
  - `BootReceiver` (`RECEIVE_BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`) calls `reconcile`.
  - `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` is declared only in `android/app/src/direct/AndroidManifest.xml`.
- [ ] **Step 4: Run** the tests, then `./gradlew assemblePlayDebug` and the merged-manifest grep from Task 6 Step 4. Expect PASS, a successful build and no forbidden permission. Then on the emulator:
  - Turn the test source on through Task 11's plugin, or with a temporary `adb shell am` hook removed before committing.
  - Check the "Orbis is active" notification appears.
  - Reboot with `adb reboot`, and check it comes back.
- [ ] **Step 5: Commit** `Add the Orbis foreground service, boot restart and battery settings`.

### Task 11: The `OrbisCore` Capacitor plugin

**Files:**
- Create `android/app/src/main/java/app/orbis/android/OrbisCorePlugin.kt`, registered in `MainActivity` (add the Kotlin plugin to `:app` if the template is Java-only).
- Create `lib/native/orbis-core.ts` and `lib/native/orbis-core.test.ts`.

**Interfaces:**
- Produces, through `registerPlugin<OrbisCorePlugin>('OrbisCore')` and `isNativeApp(): boolean` (`Capacitor.isNativePlatform()`):
  - `status(): Promise<CoreStatus>`. `CoreStatus = { registered: boolean; userId: string | null; deviceId: string | null; distribution: 'play' | 'direct'; model: string; manufacturer: string; appVersion: string; sources: Record<Source, boolean>; pausedUntil: number | null; pendingSignals: number; lastSyncAt: number | null; lastSyncError: string | null; batteryOptimized: boolean; webAuthn: boolean; signedOutReason: 'revoked' | null }`
  - `setDevice({ deviceId, secret, userId }): Promise<void>`. `serverUrl` comes from the bridge's configured server URL, never from the page. Then reconcile and sync now.
  - `signOut({ revoke: boolean }): Promise<void>`: if `revoke`, best-effort `POST /api/device/revoke` with the `Device` header and a 5 s timeout; then `wipe()` and reconcile.
  - `getPrivacy(): Promise<{ sources: Record<Source, boolean>; blockedPackages: string[]; blockedContacts: string[]; blockedKeywords: string[]; pausedUntil: number | null }>`
  - `setPrivacy({ blockedPackages?, blockedContacts?, blockedKeywords? }): Promise<void>`. Contacts are stored through `PrivacyRules.contactKey`.
  - `setSource({ source, enabled }): Promise<CoreStatus>`
  - `pause({ until }): Promise<CoreStatus>`: `0` resumes; `-1` pauses until turned back on; otherwise epoch milliseconds.
  - `testCapture({ app?, contact?, text }): Promise<{ decision: 'kept' | 'dropped'; reason?: string; masked?: string }>`: source `test`, then sync now.
  - `listApps(): Promise<{ packageName: string; label: string }[]>`: launcher apps only, through a `<queries>` launcher intent.
  - `recentActivity({ limit }): Promise<{ at: number; source: string; decision: string; reason?: string }[]>`
  - `setPushToken({ token }): Promise<void>`
  - `openBatterySettings(): Promise<void>` and `openAppInfo(): Promise<void>`

- [ ] **Step 1: Write the failing test** `orbis-core.test.ts`: under Node, `isNativeApp()` is false, and a type-level check that `CoreStatus['sources']` is keyed by `Source` from `lib/device/http.ts`.
- [ ] **Step 2: Run** the test. Expect FAIL.
- [ ] **Step 3: Implement the plugin.**
  - Every method first rejects with `not_orbis_origin` unless the WebView's current URL has the same origin as the configured server URL.
  - Run the store calls on `Dispatchers.IO`.
- [ ] **Step 4: Run** the unit tests and `./gradlew assemblePlayDebug`. Then on the emulator, through the CDP script from Task 6:
  - Call `status()`.
  - Call `setSource({source:'test', enabled:true})`.
  - Call `testCapture({text:'Your OTP is 123456'})` and expect `{decision:'kept', masked:'Your OTP is [code]'}`.
  - Call `testCapture({app:'com.authy.authy', text:'x'})` and expect `dropped/BLOCKED_APP`.
  - Load an `http://example.com` page with `webView.loadUrl` and expect the next call to reject with `not_orbis_origin`.
- [ ] **Step 5: Commit** `Add the OrbisCore Capacitor plugin`.

### Task 12: The page talks to the phone: registration, push, sign-out

**Files:**
- Create `components/native/native-bridge.tsx` (mounted once in `components/app-shell.tsx`), and `lib/native/device-state.ts` with its test.
- Modify:
  - `components/auth/sign-out-button.tsx`
  - `components/settings/notification-settings.tsx`
  - `components/auth/auth-form.tsx`

**Interfaces:**
- Consumes: Task 11's facade, and `/api/device/register` (Task 4).
- Produces: `shouldResetDevice(status: Pick<CoreStatus,'registered'|'userId'>, signedInUserId: string): 'register' | 'reset-then-register' | 'none'`

- [ ] **Step 1: Write the failing test** `device-state.test.ts` (Review Focus 2):
  - not registered gives `register`;
  - registered with the same user gives `none`;
  - registered with a different user gives `reset-then-register`;
  - registered with `userId` null gives `reset-then-register`.
- [ ] **Step 2: Run** the test. Expect FAIL.
- [ ] **Step 3: Implement.**
  - `NativeBridge` renders nothing and does nothing unless `isNativeApp()`. On mount, after the app is unlocked:
    1. read `status()`;
    2. act on `shouldResetDevice`; a reset is `signOut({revoke:true})`;
    3. register by POSTing `{name: model, flavour: distribution, appVersion}` to `/api/device/register`, then `setDevice`;
    4. if push permission is already granted, `PushNotifications.register()` and pass the token to `setPushToken`;
    5. when a push is tapped, route to `data.url`.
  - Sign-out in the native app calls `OrbisCore.signOut({revoke:true})` before the server sign-out.
  - In the native app, the notifications setting:
    - asks for permission with `PushNotifications.requestPermissions()`, then registers;
    - shows "Push isn't set up in this build yet." if registration fails because Firebase is missing;
    - hides the web-push controls.
  - The Google sign-in button is hidden in the native app; Google blocks OAuth inside WebViews.
- [ ] **Step 4: Run** `pnpm exec vitest run`, `tsc` and `lint`. All must pass.
- [ ] **Step 5: Commit** `Register the phone, wire native push and sign-out from the page`.

### Task 13: Privacy center: "What Orbis can see"

**Files:**
- Create:
  - `components/settings/privacy-center.tsx`
  - `app/personal/device-actions.ts`
  - `lib/native/pause.ts` with its test
  - `lib/native/battery-help.ts` with its test
- Modify:
  - `lib/shell/tabs.ts`: add a `SETTINGS_SECTIONS` entry `{ id: 'privacy', label: 'What Orbis can see' }` after Security, with tests
  - `components/settings/settings-sheet.tsx`: its glyph is `Eye`
  - `app/styles/page-settings.css`: only what the new rows need

**Interfaces:**
- Consumes: Tasks 4 and 11.
- Produces:
  - Server actions using the cookie client, with the same lock checks as `app/personal/actions.ts`:
    - `listDevices(): Promise<DeviceRow[]>` (id, name, flavour, last seen, revoked, enabled sources)
    - `revokeDevice(deviceId: string)`
    - `deleteSourceData(source: Source)`, which deletes `signals` and `activity_ledger` rows for that source
  - `pauseUntil(choice: 'hour' | 'tomorrow' | 'forever', now: Date): number`: `hour` is now + 3,600,000; `tomorrow` is 06:00 local on the next calendar day; `forever` is `-1`.
  - `batteryHelp(manufacturer: string): { brand: string; steps: string[] }`, keyed case-insensitively: Samsung; Xiaomi, Redmi and Poco; Oppo and Realme; Vivo and iQOO; OnePlus; and a generic default.

- [ ] **Step 1: Write failing tests.**
  - `pause.test.ts`:
    - `hour` adds 3,600,000;
    - `tomorrow` at 23:30 gives 06:00 the next day;
    - `tomorrow` at 01:00 gives 06:00 the next calendar date;
    - `forever` gives -1.
    - Use `process.env.TZ='Asia/Kolkata'`.
  - `battery-help.test.ts`: `'XIAOMI'` and `'Redmi'` both map to the Xiaomi steps; `'Google'` gets the default; every brand has at least 2 steps.
  - `tabs.test.ts`: the new section exists with its label.
- [ ] **Step 2: Run** the tests. Expect FAIL.
- [ ] **Step 3: Implement the section.**
  - **Inside the app (`isNativeApp()`):**
    1. **Sources.** The Test source is a switch. The other eight are listed and disabled, marked "Coming soon".
       - Turning a source on first shows a sheet: what is read, what is kept on the phone (30 days), what goes to the server (a short, encrypted signal), and that it can be turned off any time.
       - Turning a source off confirms with "This deletes what Orbis kept from it on this phone and on the server.", then calls `setSource(false)` and `deleteSourceData`.
    2. **Blocked apps**, from `listApps()`, with the defaults ticked.
    3. **Blocked contacts and blocked keywords**: add and remove.
    4. **Pause**: "For an hour", "Until tomorrow", "Until I turn it back on", and Resume.
    5. **Private vault.** "Private Space and Secure Folder are separate from the rest of your phone. Orbis can't see them."
    6. **Keep Orbis running**, shown when `batteryOptimized`. It has the `batteryHelp` steps plus "Open battery settings" and "Open app info" buttons.
    7. **Recent activity**: the last 50 entries, each with source, time, kept or dropped, and the reason; never content.
    8. **Try it**: a Test-source form with app, contact and text fields that shows the decision and the masked text.
  - **On the web:**
    - "Your phones", from `listDevices()`, with last seen, sources on, and "Remove this phone".
    - Per source, "Delete what Orbis kept".
    - "Install the Android app to choose what Orbis reads."
- [ ] **Step 4: Check the result.**
  - Run `pnpm exec vitest run`, `tsc` and `lint`. All must pass.
  - On the emulator, run end to end against a staging server or the local dev server. Never create test accounts on production.
    1. Sign in.
    2. Turn the test source on.
    3. Send `Your OTP is 123456`, plus one item for each blocked kind.
    4. The server shows one `signals` row for the device, whose `content` starts with `p1.`.
    5. "Remove this phone" on the web leads, after the next sync, to the app showing signed out and holding an empty store.
  - If no staging server exists yet, record this step as an owner hand-off in Task 14 rather than skipping it silently.
- [ ] **Step 5: Commit** `Add the privacy center: what Orbis can see`.

### Task 14: Release docs and owner hand-off

**Files:**
- Create `docs/ops/android.md` and `docs/ops/phase-1-owner-actions.md`.
- Modify `README.md` (short Android section) and `.env.example`.

- [ ] **Step 1: Write `docs/ops/android.md`:**
  - Prerequisites: JDK 21 and the SDK.
  - `npx cap sync android`.
  - Debug builds against a local server (`ORBIS_URL=http://10.0.2.2:3000 npx cap sync android`).
  - Release signing with a keystore kept outside the repo, its passwords in `~/.gradle/gradle.properties`, and `./gradlew bundlePlayRelease` / `assembleDirectRelease`.
  - Putting `google-services.json` in `android/app/` (gitignored).
  - Generating `ORBIS_PHONE_DATA_KEY` with `openssl rand -base64 32`. Losing it makes stored phone signals unreadable.
  - `FCM_SERVICE_ACCOUNT` (`base64 -w0 service-account.json`).
  - `ANDROID_APP_ID` and `ANDROID_CERT_SHA256`, using Play App Signing's SHA-256 and the upload key's.
  - Checking `/.well-known/assetlinks.json`.
  - The Supabase passkey RP ID must be the site host for in-app passkeys.
  - The `specialUse` foreground-service justification text for Play.
- [ ] **Step 2: Write `docs/ops/phase-1-owner-actions.md`** as an ordered list:
  1. Confirm or replace the `applicationId` `app.orbis.android` before the first upload. It is permanent on Play.
  2. Create the Play developer account (organisation versus personal; see spec §9).
  3. Create the Firebase project, add the Android app, download `google-services.json`, and create the service account.
  4. Set `ORBIS_PHONE_DATA_KEY`, `FCM_SERVICE_ACCOUNT`, `ANDROID_APP_ID` and `ANDROID_CERT_SHA256` in Vercel.
  5. Apply migration `202611120004_devices.sql`.
  6. Upload to the internal testing track, and start the 12-tester, 14-day closed test if the account is personal.
  7. Name the test phones (make, model, Android version).
  8. On a Samsung and a Xiaomi phone, the 48-hour check:
     - the service is still running and its notification shown;
     - sync happened in the last hour;
     - battery use is under about 3% a day;
     - a notification from Private Space or Secure Folder never shows in Recent activity.
  9. Review the privacy policy wording for phone data. Embeddings and phone signals are not in Phase 1; the per-user encryption is.
  10. Run Task 13's end-to-end check on staging if it was handed off.
- [ ] **Step 3: Check and commit.** Run `pnpm exec vitest run`, `tsc`, `lint` and `pnpm build`, then `cd android && ./gradlew testDebugUnitTest assemblePlayDebug assembleDirectDebug`. All must pass. Revert `next-env.d.ts` if the build rewrote it. Commit `Document Android builds and the Phase 1 owner steps`.
