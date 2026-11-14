# Phase 2, part 1: reading notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Orbis on Android reads the phone's notifications once the person turns that source on, sorts them on the phone into payments, deliveries, missed calls and job mail, and turns payments into transactions the person reviews in Money before they count. Phase 1's two carry-overs are fixed first.

**Architecture:**
- **On the phone:** a `NotificationListenerService` in `orbis-core` maps each posted notification to a `CapturedItem` and hands it to the existing `OrbisStore.capture`.
- **Sorting:** the capture pipeline asks a pure `NotificationSorter` for a signal `kind` and content.
  - One-time codes are dropped outright.
  - Anything unsorted stays only as a raw item on the phone (30 days); no signal is made for it.
- **Server:** signals sync through the existing `/api/device/signals`. Money reads `transaction` signals, decrypts them, and offers Accept or Dismiss.
  - Accept writes an ordinary `transactions` row with `source = 'phone'` and deletes the signal. Dismiss deletes the signal.

**Tech Stack:** Kotlin (orbis-core, JUnit 4, hand-written fakes, real `org.json`), Capacitor plugin, Next.js 16 server actions, Supabase (RLS), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-12-android-agent-design.md`. This plan covers §7 Phase 2 item 1 (Notifications), the parts of §4 and §6 it touches, and the two Phase 1 carry-overs recorded in the owner's memory: move the different-user reset to sign-in time; make `deleteSourceData` per-device.

## Global Constraints

- "Each source is a separate opt-in with its own disclosure" (§7 Phase 2). Turning a source on shows "a plain explanation (what's read, what's kept, where it goes) and then the Android permission prompt" (§6).
- "A blocked app, blocked contact, excluded source or paused state means the item is never written anywhere" (§4.4). That stays enforced by `PrivacyRules.decide`, which runs before any sorting.
- "OTPs, passwords, card and account numbers are masked on the phone before anything is stored" (§4.4). The sorter drops one-time-code notifications entirely (§5: "OTP drop").
- "Raw items … kept for 30 days by default" on the phone. "What syncs to Supabase are derived signals" (§4.5). Unsorted notifications make no signal.
- "Bank and UPI alerts → `transaction` signals into Money's review queue (the same 'review before it counts' rule the Gmail parser used); delivery updates → `package`; missed WhatsApp or regular calls → `missed_contact`; recruiter and job mail → Career" (§7 Phase 2.1).
- "Once the person accepts a phone signal into an existing module … it becomes an ordinary row there" (§4.7). "Turning a source off deletes its signals, its pending-review items … Rows the person already accepted into Money or Career stay" (§4.7).
- "Any notification from another profile is dropped as a safety net" (§6). This is already `DropReason.OTHER_PROFILE`; the listener must set `fromOtherProfile` correctly.
- Signal content ≤ 4,000 characters (`lib/device/http.ts` limit). Kinds match `^[a-z][a-z_]{0,39}$`, so the server's sync code needs no change for new kinds.
- Repo rules:
  - Work on branch `phone-notifications`, in the existing worktree `F:\Orbis\orbis-android`: run `git switch -c phone-notifications main` there.
  - **Commit after every task** (the owner's standing rule).
  - Merge into `main` only when the whole plan is finished and reviewed.
  - The app repo is public: no secrets.
- Commands:
  - **Kotlin:** from `android/`, run `./gradlew :orbis-core:testDebugUnitTest :app:testPlayDebugUnitTest assemblePlayDebug assembleDirectDebug`.
  - **Web:** `pnpm exec vitest run`, after `assemblePlayDebug`, because `lib/native/manifest.test.ts` reads the merged manifest. Also `pnpm -s tsc --noEmit -p .` and `pnpm -s lint`.

## Rulings made while writing this plan

- **R1. Money's review queue is rebuilt, small.**
  - The Gmail review queue and `parse-alert.ts` were deleted in 563a9f9.
  - Phone transactions get their own small queue: the `transaction` signals themselves, listed in Money. Accept turns one into a `transactions` row; Dismiss deletes it.
  - No new queue table: the signal is the pending item, which also makes "turning a source off deletes its pending-review items" true for free.
- **R2. Parse on the phone, in Kotlin.** `TransactionParser` ports the deleted `parseTransactionAlert` (`git show 563a9f9^:lib/finance/parse-alert.ts`) with the same patterns and the same refusal of ambiguous text.
  - Classification and parsing read the raw text in memory. Only the masked text and the parsed fields are stored or synced. The merchant also goes through `Masking.mask`.
- **R3. Banking apps stay blocked by default.**
  - `DefaultBlocklist` blocks SBI, HDFC, ICICI, Axis and Kotak's apps (spec §6: "starts with banking and password-manager apps pre-ticked").
  - Bank and UPI alerts in India also arrive by SMS. The SMS app's notifications are read unless the person blocks the sender. The disclosure says so.
- **R4. Consumers are built for `transaction` only.**
  - `package`, `missed_contact` and `career` signals are sorted, synced and encrypted now, so the data is there.
  - Their consumers (Today heads-ups, Career intake) come in part 2, alongside the Calls source, which also produces `missed_contact`.
  - Raw notifications reaching Ask stays with Phase 4 / decision 8 (the WebView asks `OrbisCore`), as the spec defers Ask's rebuild there.
- **R5. Sign-in reset.**
  - `NativeBridge` only mounts after unlock. A new `NativeAccountGuard` renders beside the lock and PIN screens that `appGate()` returns.
  - It wipes this phone's Orbis data the moment the signed-in person differs from the phone's registered person, before unlock.
  - Registering again stays with `NativeBridge` after unlock, as today.
- **R6. Per-device delete.**
  - `deleteSourceData(source, deviceId?)`. Turning a source off on a phone deletes only that phone's server rows.
  - The web's "kept" row (no phone in hand) still deletes the source's rows from every phone, and its button says "from all your phones".

## Review Focus

1. **A repeated notification** (apps re-post the same notification on every update, such as a download's progress or a chat's growing thread) must not make duplicate raw items or duplicate transactions. → Task 5 test `the same key and text is read once`.
2. **A payment alert with two amounts** ("Rs 500 debited, available balance Rs 12,000") must not guess. → Task 3 test `two amounts in one sentence is not a transaction`.
3. **A notification from a blocked app or contact that looks like a payment** must leave nothing: no raw item, no signal, only a dropped ledger entry. → Task 4 test `a blocked sender's payment alert writes nothing but the ledger`.
4. **Accepting the same phone transaction twice** (double tap, two tabs) must not make two rows. → Task 7 test `accepting twice saves one row`.
5. **The listener while the source is off** (access granted, switch off) must not fill the ledger with a "dropped" line for every notification. → Task 5 test `nothing is read while the source is off`.

---

### Task 1: Wipe the phone at sign-in when the person changes

**Files:**
- Modify: `lib/native/device-state.ts` (add `wipeAtSignIn`)
- Test: `lib/native/device-state.test.ts`
- Create: `components/native/native-account-guard.tsx`
- Modify: `lib/auth/app-gate.tsx:44-46` (render the guard beside `LockScreen` and `PinSetup`)

**Interfaces:**
- Consumes:
  - `shouldResetDevice(status, signedInUserId)` (`lib/native/device-state.ts:15`)
  - `OrbisCore.status()`, `OrbisCore.signOut({ revoke: true })` (`lib/native/orbis-core.ts`)
  - `resetPhoneLink()` (`lib/native/link-phone.ts`)
- Produces: `wipeAtSignIn(status: Pick<CoreStatus, 'registered' | 'userId'> | null, signedInUserId: string): boolean`, and `<NativeAccountGuard userId={string} />`.

- [ ] **Step 1: Write the failing tests** in `lib/native/device-state.test.ts`:

```ts
test('wipeAtSignIn: a phone registered to someone else is wiped', () => {
  assert.equal(wipeAtSignIn({ registered: true, userId: 'old' }, 'new'), true);
});
test('wipeAtSignIn: the same person, an unregistered phone, or no phone at all is left alone', () => {
  assert.equal(wipeAtSignIn({ registered: true, userId: 'me' }, 'me'), false);
  assert.equal(wipeAtSignIn({ registered: false, userId: null }, 'me'), false);
  assert.equal(wipeAtSignIn(null, 'me'), false);
});
```

- [ ] **Step 2:** Run `pnpm exec vitest run lib/native/device-state.test.ts`. Expected: FAIL, `wipeAtSignIn` is not exported.
- [ ] **Step 3:** Implement `wipeAtSignIn` as `status !== null && shouldResetDevice(status, signedInUserId) === 'reset-then-register'`.
- [ ] **Step 4:** Write `NativeAccountGuard`, a client component.
  - It renders nothing.
  - On mount, it runs only inside the native app: use the same native check `native-bridge.tsx` uses.
  - It reads `OrbisCore.status()`. If `wipeAtSignIn(status, userId)`, it calls `resetPhoneLink()`, then `OrbisCore.signOut({ revoke: true })`.
  - It swallows plugin errors with one `console.error('Phone account check failed', error)`.
- [ ] **Step 5:** In `appGate()`, return `render: <><NativeAccountGuard userId={userId} /><LockScreen … /></>` (and the same around `PinSetup`). `NativeBridge` keeps handling the unlocked case.
- [ ] **Step 6:** Run `pnpm exec vitest run lib/native` and `pnpm -s tsc --noEmit -p .`. Expected: PASS, no type errors.
- [ ] **Step 7: Commit.** `git commit -m "Phone: wipe Orbis data at sign-in when a different person signs in"`

### Task 2: Turning a source off on a phone deletes only that phone's rows

**Files:**
- Modify: `app/personal/device-actions.ts:110-120`
- Modify: `components/settings/privacy-center.tsx:97,371,411` (pass the device id from the phone; reword the web button)
- Test: `lib/device/device-actions.test.ts`

**Interfaces:**
- Produces: `deleteSourceData(source: Source, deviceId?: string): Promise<{ success: boolean; message: string }>`.

- [ ] **Step 1: Write the failing tests** with the file's existing fake client:
  - `a phone's turn-off deletes only that phone's signals and ledger`. Assert both deletes carry `.eq('device_id', 'dev-1')` as well as `user_id` and `source`.
  - `the web delete, with no device, still clears every phone`. Assert no `device_id` filter.
  - `a device id that is not one of this person's phones is refused`. The fake `devices` select returns no row. Assert `{ success: false }` and that no delete ran.
- [ ] **Step 2:** Run `pnpm exec vitest run lib/device/device-actions.test.ts`. Expected: the 3 new tests FAIL.
- [ ] **Step 3: Implement.**
  - When `deviceId` is given, first `select('id').eq('id', deviceId).eq('user_id', auth.userId).maybeSingle()` on `devices`. With no row, return `{ success: false, message: 'That phone isn’t linked to your account.' }`.
  - Then add `.eq('device_id', deviceId)` to both deletes.
- [ ] **Step 4: Update the callers.**
  - `Sources.turnOff` passes `status.deviceId` (the phone in hand).
  - `KeptRow` (web) passes none, and its confirm button reads `Delete from all your phones`.
- [ ] **Step 5:** Run `pnpm exec vitest run lib/device` and `pnpm -s tsc --noEmit -p .`. Expected: PASS.
- [ ] **Step 6: Commit.** `git commit -m "Phone: turning a source off deletes only that phone's rows"`

### Task 3: Sort a notification on the phone (pure Kotlin)

**Files:**
- Create: `android/orbis-core/src/main/kotlin/app/orbis/core/notify/TransactionParser.kt`
- Create: `android/orbis-core/src/main/kotlin/app/orbis/core/notify/NotificationSorter.kt`
- Test: `android/orbis-core/src/test/kotlin/app/orbis/core/notify/TransactionParserTest.kt`, `NotificationSorterTest.kt`

**Interfaces:**
- Produces:
  - `data class ParsedTransaction(val amount: String /* "1250.00" */, val currency: String, val direction: String /* "expense"|"income" */, val merchant: String?)`
  - `object TransactionParser { fun parse(text: String): ParsedTransaction? }`. It returns null unless exactly one candidate segment has exactly one amount and one direction, which is the old TS rule.
  - `data class Sorted(val kind: String, val content: String)`
  - `object NotificationSorter { fun isOneTimeCode(text: String): Boolean; fun sort(packageName: String?, rawText: String, maskedText: String): Sorted? }`
  - Kinds: `"transaction"`, `"package"`, `"missed_contact"`, `"career"`.
  - Content: a JSON object with `"v":1`, `"app"` (the package name or null) and `"text"` (masked, at most 1,000 characters). `transaction` adds `amount`, `currency`, `direction`, and `merchant` (masked with `Masking.mask`). `missed_contact` adds `"who"` (the notification title, masked).
  - Sort order: missed call, then transaction, then package, then career, else null.
  - Missed call: the package is in `DIALERS = setOf("com.google.android.dialer", "com.samsung.android.dialer", "com.android.dialer", "com.android.server.telecom", "com.whatsapp", "com.whatsapp.w4b")` and the text matches `(?i)\bmissed (voice |video )?call`.
  - Transaction: `TransactionParser.parse(rawText) != null`.
  - Package: `(?i)\b(out for delivery|delivered|shipped|dispatched|arriving (today|tomorrow)|order (has been )?(placed|confirmed))\b`.
  - Career: the package is in `JOB_APPS = setOf("com.google.android.gm", "com.microsoft.office.outlook", "com.linkedin.android", "naukriApp.appModules.login", "com.indeed.android.jobsearch")` and the text matches `(?i)\b(interview|recruiter|shortlisted|hiring|offer letter|job (offer|opening|application)|application (received|update|status))\b`.
  - `isOneTimeCode`: `(?i)\b(otp|one[- ]time (password|code)|verification code|security code|login code)\b`, or `(?i)\bcode\b` within 40 characters of a 4–8 digit run.

- [ ] **Step 1: Write the failing tests.**
  - `TransactionParserTest`, with these exact cases:
    - `"Rs.1,250.00 debited from A/c XX1234 on 14-11-26 to SWIGGY. Not you? Call 1800"` → `ParsedTransaction("1250.00","INR","expense","SWIGGY")`
    - `"INR 5,000 credited to your account by NEFT"` → income `"5000.00"`
    - `"₹499 paid to Zomato via UPI"` → expense, merchant `"Zomato"`
    - `"Rs 500 debited. Avl bal Rs 12,000"` → expense 500. These are two segments, but only one carries a direction; keep the old rule's behaviour and pin whatever it returns, after first running the old TS on the same text with `node -e`.
    - `two amounts in one sentence is not a transaction`: `"Rs 500 debited and Rs 200 credited"` → null
    - `"Your order is on the way"` → null
  - `NotificationSorterTest`:
    - an SMS bank alert → `transaction`, with content JSON fields as above;
    - `"Missed voice call"` from `com.whatsapp` → `missed_contact`;
    - `"Missed call"` from a non-dialer package → null;
    - `"Your package was delivered"` → `package`;
    - an interview mail from `com.google.android.gm` → `career`;
    - a chat message → null;
    - `isOneTimeCode("123456 is your OTP for login")` → true;
    - `isOneTimeCode("Use code 4821 to sign in")` → true;
    - `isOneTimeCode("Rs 1,250 debited")` → false;
    - content is ≤ 4,000 characters for a 10,000-character text.
- [ ] **Step 2:** From `android/`, run `./gradlew :orbis-core:testDebugUnitTest --tests 'app.orbis.core.notify.*'`. Expected: FAIL to compile (no classes yet).
- [ ] **Step 3: Implement both objects** with `org.json.JSONObject` for content. Port the money, direction and merchant patterns from the old TS verbatim. Amounts become two-decimal strings through `BigDecimal`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "orbis-core: sort notifications into payments, deliveries, missed calls and job mail"`

### Task 4: The capture pipeline uses the sorter for notifications

**Files:**
- Modify: `android/orbis-core/src/main/kotlin/app/orbis/core/store/CapturePipeline.kt:18-70`
- Modify: `android/orbis-core/src/main/kotlin/app/orbis/core/rules/Decision.kt` (add `ONE_TIME_CODE` to `DropReason`)
- Modify: `lib/native/privacy-words.ts` `reasonWords` (add `one_time_code` → `'One-time code'`), with its test.
- Test: `android/orbis-core/src/test/kotlin/app/orbis/core/store/CapturePipelineTest.kt` (reuse `FakePort`)

**Interfaces:**
- Consumes: `NotificationSorter.isOneTimeCode`, `NotificationSorter.sort` (Task 3).
- Produces: for `Source.NOTIFICATIONS`, `capture()` returns `Drop(ONE_TIME_CODE)` and writes only a dropped ledger entry for a code. Otherwise it writes the raw item, plus a `PendingSignal` only when `sort()` is non-null, with that `kind` and `content`. Every other source keeps `"${wire}_item"` exactly as today.

- [ ] **Step 1: Write the failing tests:**
  - `a notification payment makes a raw item and a transaction signal`
  - `an unsorted notification makes a raw item and no signal`
  - `a one-time code is dropped and leaves only a ledger entry`
  - `a blocked sender's payment alert writes nothing but the ledger`: `blockedContacts = setOf(contactKey("AX-HDFCBK"))`, with the item's contacts `["AX-HDFCBK"]`.
  - `a blocked app's payment alert writes nothing but the ledger`: the package is in `DefaultBlocklist.PACKAGES`.
  - `the test source still makes test_item signals`
- [ ] **Step 2:** Run `./gradlew :orbis-core:testDebugUnitTest --tests '*CapturePipelineTest'`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** After `PrivacyRules.decide` returns `Keep(masked)`, and for `NOTIFICATIONS` only:
  - if `isOneTimeCode(item.text)`, call `insertDropped(entry with reason ONE_TIME_CODE)` and return `Drop(ONE_TIME_CODE)`;
  - otherwise `insertKept(raw, sort(...)?.let { PendingSignal(kind = it.kind, content = it.content, …) }, entry)`.
- [ ] **Step 4:** Run all orbis-core unit tests and `pnpm exec vitest run lib/native/privacy-words.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "orbis-core: notifications keep raw items and sync only sorted signals; drop one-time codes"`

### Task 5: The notification listener

**Files:**
- Create: `android/orbis-core/src/main/kotlin/app/orbis/core/notify/NotificationReader.kt` (pure)
- Create: `android/orbis-core/src/main/kotlin/app/orbis/core/notify/OrbisNotificationListener.kt`
- Modify: `android/orbis-core/src/main/AndroidManifest.xml`
- Modify: `android/orbis-core/src/main/kotlin/app/orbis/core/store/OrbisStore.kt` (add `suspend fun sourceEnabled(source: Source): Boolean`, reading the same settings `capture` reads)
- Modify: `lib/native/manifest.test.ts`
- Test: `android/orbis-core/src/test/kotlin/app/orbis/core/notify/NotificationReaderTest.kt`

**Interfaces:**
- Produces:
  - `data class NotificationFacts(val key: String, val packageName: String, val title: String?, val text: String?, val bigText: String?, val postTime: Long, val ongoing: Boolean, val groupSummary: Boolean, val otherProfile: Boolean)`
  - `object NotificationReader { fun toItem(f: NotificationFacts, ownPackage: String): CapturedItem? }`. It returns null for Orbis's own package, ongoing notifications, group summaries, and a blank title and text. Otherwise:
    - `text = listOfNotNull(title, bigText ?: text).joinToString("\n")`
    - `contacts = listOfNotNull(title)`
    - `occurredAt = postTime`
    - `fromOtherProfile = otherProfile`
  - `class RecentKeys(capacity: Int = 200) { fun firstTime(key: String, text: String): Boolean }`: an LRU of `key + text.hashCode()`.
  - Manifest service:

```xml
<service android:name="app.orbis.core.notify.OrbisNotificationListener" android:label="Orbis" android:exported="true"
    android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE">
  <intent-filter><action android:name="android.service.notification.NotificationListenerService" /></intent-filter>
</service>
```

- [ ] **Step 1: Write the failing tests:**
  - `NotificationReaderTest`: `own package is skipped`; `ongoing and group summaries are skipped`; `title and big text are joined`; `the same key and text is read once` (via `RecentKeys`); `another profile is marked`.
  - `lib/native/manifest.test.ts`: `both flavours declare the notification listener behind BIND_NOTIFICATION_LISTENER_SERVICE`.
- [ ] **Step 2:** Run the orbis-core unit tests and `assemblePlayDebug assembleDirectDebug`, then `pnpm exec vitest run lib/native/manifest.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `OrbisNotificationListener : NotificationListenerService`.**
  - A `CoroutineScope(SupervisorJob() + Dispatchers.IO)`, cancelled in `onListenerDisconnected` and `onDestroy`.
  - `onNotificationPosted(sbn)`:
    - build `NotificationFacts` from `sbn.notification.extras` (`EXTRA_TITLE`, `EXTRA_TEXT`, `EXTRA_BIG_TEXT`, as `toString()`), `sbn.key`, `sbn.postTime`, `sbn.isOngoing`, `FLAG_GROUP_SUMMARY`, and `sbn.user != Process.myUserHandle()`;
    - then, in the scope: `if (!store.sourceEnabled(Source.NOTIFICATIONS)) return`, so nothing is read while the source is off;
    - map with `toItem`, check `RecentKeys.firstTime`, and call `store.capture(item)`;
    - when the decision is `Keep` and `NotificationSorter.sort(item.packageName, item.text, item.text)?.kind == "transaction"`, call `SyncScheduler.now(context)`. Recomputing is cheap, and it leaves `capture`'s return type as it is.
- [ ] **Step 4:** Run the same commands. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "orbis-core: read posted notifications into the capture pipeline"`

### Task 6: Turning on Notifications in the privacy center

**Files:**
- Modify: `android/app/src/main/java/app/orbis/android/OrbisCorePlugin.kt` (add `notificationAccess` and `openNotificationAccess`)
- Modify: `lib/native/orbis-core.ts:74-109` (both interface blocks)
- Modify: `lib/native/privacy-words.ts` (add `TURN_ON_WORDS`)
- Modify: `components/settings/privacy-center.tsx:21,320-358` (`READY` gains `'notifications'`; `TurnOnSheet` reads `TURN_ON_WORDS[source]`; after turning on, if access isn't granted, show the access button)
- Test: `lib/native/privacy-words.test.ts`, `android/app/src/test/java/app/orbis/android/PluginInputTest.kt` (if the plugin parses any input)

**Interfaces:**
- Produces:
  - `OrbisCore.notificationAccess(): Promise<{ granted: boolean }>`, from `NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)`.
  - `OrbisCore.openNotificationAccess(): Promise<void>`, which starts `Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS` with `FLAG_ACTIVITY_NEW_TASK`.
  - `TURN_ON_WORDS: Partial<Record<Source, { title: string; read: string; kept: string; goes: string; next: string }>>`, with the test source's current wording moved in unchanged, and notifications exactly:
    - title: `Read your notifications`
    - read: `The title and text of notifications that arrive on this phone. Blocked apps and contacts are skipped, and banking apps start blocked. Bank and UPI text messages are read unless you block the sender.`
    - kept: `The text stays on this phone, encrypted, for 30 days. Card and account numbers are hidden first, and one-time codes are never kept.`
    - goes: `Only what Orbis sorts out leaves the phone, encrypted: payments for you to review in Money, deliveries, missed calls and job mail.`
    - next: `Next, Android asks you to give Orbis notification access. If it says the setting is restricted, open App info for Orbis, tap the menu, and choose Allow restricted settings.`

- [ ] **Step 1: Write the failing tests** (`privacy-words.test.ts`):
  - `notifications has its own turn-on words`: assert all five fields are non-empty.
  - `every READY source has turn-on words`: export `READY` from a pure module (move it to `lib/native/privacy-words.ts`) and check each one.
- [ ] **Step 2:** Run `pnpm exec vitest run lib/native/privacy-words.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the words, the plugin methods and the sheet.
  - After `setSource('notifications', true)`, call `notificationAccess()`.
  - If access isn't granted, the source row shows the line `Orbis can’t read notifications yet.` and a button, `Open notification access`, which calls `openNotificationAccess()`.
  - Re-check on `visibilitychange`.
- [ ] **Step 4:** Run vitest, tsc, lint and `./gradlew :app:testPlayDebugUnitTest assemblePlayDebug assembleDirectDebug`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Privacy center: turn on Notifications, with its disclosure and the access step"`

### Task 7: Money reads phone payments to review

**Files:**
- Create: `supabase/migrations/202611140003_phone_transactions.sql`
- Create: `lib/finance/phone-review.ts`
- Create: `app/finance/phone-review-actions.ts` (`'use server'`)
- Test: `lib/finance/phone-review.test.ts`

**Interfaces:**
- Consumes: `decryptForUser(userId, envelope, signalId)` (`lib/crypto/user-keys.ts:63`); the `signals` table; the category lists in `lib/finance/manual.ts`.
- Produces:
  - `type PhoneTransaction = { signalId: string; amount: number; currency: string; direction: 'expense' | 'income'; merchant: string | null; occurredAt: string; text: string }`
  - `readTransactionSignal(signalId: string, occurredAt: string, json: string): PhoneTransaction | null`. Pure. Null for bad JSON, `v !== 1`, an amount that isn't a positive finite number ≤ 100,000,000, an unknown direction, or a currency that isn't `^[A-Z]{3}$`.
  - `listPhoneTransactions(db: SupabaseClient, userId: string): Promise<PhoneTransaction[]>`: `signals` where `source = 'notifications'` and `kind = 'transaction'`, newest first, limit 50. Each is decrypted; rows that fail to decrypt or read are skipped with one `console.error` per load.
  - `acceptPhoneTransactionAction(input: { signalId: string; category: string; merchant?: string; direction?: 'expense' | 'income' }): Promise<{ success: boolean; message: string }>`. It re-reads and decrypts the signal on the server (never trusts the client's amount), inserts into `transactions` with `source: 'phone'`, `source_signal_id: signalId`, `source_message_id: null`, `payment_method: null`, `note: null`, then deletes the signal and calls `revalidatePath('/active')`.
  - `dismissPhoneTransactionAction(signalId: string): Promise<{ success: boolean; message: string }>`: deletes the signal (RLS-scoped; also `.eq('user_id', userId)`).
  - Migration:

```sql
alter table public.transactions drop constraint if exists transactions_source_check;
alter table public.transactions add constraint transactions_source_check check (source in ('gmail','manual','phone'));
alter table public.transactions add column if not exists source_signal_id uuid;
create unique index if not exists transactions_user_signal_unique on public.transactions (user_id, source_signal_id) where source_signal_id is not null;
```

  Check the real constraint name in `202609240001_finance_gmail.sql` before writing the migration. Its rule tying `source_message_id` to `gmail` must still allow `phone` with a null message id.

- [ ] **Step 1: Write the failing tests:**
  - `readTransactionSignal reads a good signal`
  - `readTransactionSignal refuses bad JSON, v 2, amount 0, amount "abc", direction "transfer", currency "rupees"`
  - `accepting twice saves one row`: the fake insert returns `23505` the second time. The action reports success (`Already in Money.`) and still deletes the signal.
  - `accept uses the server's amount, not the client's`: the input carries no amount field at all.
  - `dismiss deletes only this person's signal`
- [ ] **Step 2:** Run `pnpm exec vitest run lib/finance/phone-review.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep the action thin: put the logic in `lib/finance/phone-review.ts` so it's testable, with the action resolving the user and the client. A `42P01` (no `signals` table yet) reads as an empty list, as `listDevices` already does.
- [ ] **Step 4:** Run vitest and tsc. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Money: phone payments wait for review, then become ordinary transactions"`

### Task 8: The review list in Money

**Files:**
- Create: `components/money/phone-review.tsx`
- Modify: `components/money/spending-screen.tsx:140-146` (render `<PhoneReview />` right after `{notices}`)
- Modify: `app/styles/page-money.css` (classes prefixed `pr-`)

**Interfaces:**
- Consumes: Task 7's `listPhoneTransactions` (through a `loadPhoneTransactionsAction(): Promise<PhoneTransaction[]>` added to `app/finance/phone-review-actions.ts`), `acceptPhoneTransactionAction`, `dismissPhoneTransactionAction`, and `EXPENSE_CATEGORIES` / `INCOME_CATEGORIES`.

- [ ] **Step 1: Write the failing test** in `lib/finance/phone-review.test.ts`: `reviewLine formats amount, merchant and day`.
  - `reviewLine(t: PhoneTransaction, locale: string, currency: string): { title: string; meta: string }`, a pure helper in `lib/finance/phone-review.ts`.
  - Title: `Swiggy, ₹1,250` (or `Payment, ₹1,250` with no merchant).
  - Meta: `Spent, 14 Nov` or `Received, 14 Nov`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement the helper and the component.**
  - Draw nothing when the list is empty.
  - Otherwise, a section headed `From your phone, to review`. Each row has its title and meta, a category `<select>` (default `Other`), and two buttons: `Add to Money` and `Not a payment`.
  - One action at a time per row; a failed action keeps the row and shows the message.
  - Use theme tokens only and `:focus-visible` on every control, as the rest of Money does.
- [ ] **Step 4:** Run vitest, tsc and lint. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Money: review payments read from the phone"`

### Task 9: The owner's steps and the docs

**Files:**
- Create: `docs/ops/phase-2-notifications-owner-actions.md`
- Modify: `docs/ops/android.md` (the notification listener, how to test it with `adb shell cmd notification post`)

- [ ] **Step 1: Write the owner's steps.**
  - Apply `202611140003_phone_transactions.sql` in the Supabase SQL editor.
  - Build and install the `direct` APK.
  - On Android 13+, "Allow restricted settings" in App info.
  - Turn on Notifications.
  - Send yourself a test bank SMS and check it appears in Money under "From your phone, to review".
  - Block the sender and check the next one doesn't.
  - Check that a WhatsApp missed call and a delivery notification land as signals, using the account export.
- [ ] **Step 2: Document the emulator check.**

```
adb shell cmd notification post -S bigtext -t "AX-HDFCBK" bank "Rs.1,250.00 debited from A/c XX1234 to SWIGGY"
```

  Expected: one row in Money after the next sync.
- [ ] **Step 3: Run the full check.**
  - From `android/`: `./gradlew :orbis-core:testDebugUnitTest :app:testPlayDebugUnitTest assemblePlayDebug assembleDirectDebug`.
  - Then `pnpm exec vitest run`, `pnpm -s tsc --noEmit -p .` and `pnpm -s lint`.
  - Expected: everything passes, with lint at the 5 existing warnings.
- [ ] **Step 4: Commit.** `git commit -m "Docs: owner steps and emulator check for reading notifications"`
