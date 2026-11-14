# Orbis for Android

How to build, test and release the Android app. The app is a thin shell: the Android WebView loads the hosted site, and a small Kotlin module (`android/orbis-core`) does the phone-only work: privacy rules, the local encrypted store, syncing, and the "Orbis is active" service. The code is in `android/`; the web side is under `app/api/device/` and `lib/device/`.

Owner steps (accounts, keys, phones) are in [`phase-1-owner-actions.md`](./phase-1-owner-actions.md). This page is the how-to behind them.

## Two builds

- **`play`** goes to the Play Store. It must never ask for these five permissions, and the merged manifest strips them even if a library adds one: `READ_SMS`, `READ_CALL_LOG`, `BIND_ACCESSIBILITY_SERVICE`, `QUERY_ALL_PACKAGES`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`. This is done with `tools:node="remove"` in `android/app/src/play/AndroidManifest.xml`.
- **`direct`** is the sideloaded build for your own phone. Permissions only it may ask for go in `android/app/src/direct/AndroidManifest.xml` (today: `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`). Never put one in `src/main`.

## Building

You need JDK 21 and the Android SDK (platforms 34 to 36). Tell Gradle where they are:

```bash
export JAVA_HOME=F:/dev/jdk-21            # your JDK 21 folder
export ANDROID_HOME=F:/dev/android-sdk    # your SDK folder
export GRADLE_USER_HOME=F:/dev/gradle-home  # optional: keeps Gradle's cache off the C: drive
```

On a fresh clone, install the web packages and sync Capacitor before Gradle. Gradle fails without the sync:

```bash
pnpm install
npx cap sync android
cd android
./gradlew assemblePlayDebug assembleDirectDebug
```

The APKs land in `android/app/build/outputs/apk/`. Install one on a phone or emulator with `adb install -r <file>.apk`.

### Pointing a debug build at a local server

The app loads `https://orbis-starter.vercel.app` unless told otherwise. The address is baked in when you run `cap sync`, so set it then:

```bash
ORBIS_URL=http://10.0.2.2:3000 npx cap sync android
```

`10.0.2.2` is how the Android emulator reaches your computer. Run `pnpm dev`, then build and install.

- **Plain http is allowed only for an http address.** Android blocks unencrypted (cleartext) traffic by default. When `ORBIS_URL` starts with `http://`, `capacitor.config.ts` turns on Capacitor's `server.cleartext` so the WebView can load it; for any `https://` address (the hosted site, a tunnel) it stays off.
- **Or use https.** An https tunnel to your computer (for example `cloudflared tunnel --url http://localhost:3000`) needs no cleartext at all: `ORBIS_URL=https://<tunnel address> npx cap sync android`.
- Careful: `.env.local` points at production Supabase, so a local server still talks to your real data.
- **Sync again without `ORBIS_URL` before building anything you will release.** Otherwise the release loads your computer, and with an http address it also carries the cleartext switch.

### Release signing

Release builds are signed with an upload key you create once. Keep the keystore file outside the repo (the repo is public; `*.jks`, `*.keystore` and `keystore.properties` are git-ignored as a backstop).

1. Create the key (keep the file and both passwords somewhere safe; losing it is recoverable on Play, but only by asking Google):

   ```bash
   keytool -genkeypair -v -keystore ~/orbis-upload.jks -alias orbis-upload -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Put its details in `~/.gradle/gradle.properties` (your home folder, not the repo):

   ```properties
   ORBIS_UPLOAD_STORE_FILE=C:/Users/you/orbis-upload.jks
   ORBIS_UPLOAD_STORE_PASSWORD=...
   ORBIS_UPLOAD_KEY_ALIAS=orbis-upload
   ORBIS_UPLOAD_KEY_PASSWORD=...
   ```

3. Build:

   ```bash
   cd android
   ./gradlew bundlePlayRelease      # the Play Store bundle (.aab), under app/build/outputs/bundle/
   ./gradlew assembleDirectRelease  # the sideload APK, under app/build/outputs/apk/direct/release/
   ```

Without those four lines the release builds still run but come out unsigned, and Play or Android will refuse them.

Bump `versionCode` in `android/app/build.gradle` for every upload. Play rejects a repeat.

## Push (Firebase)

Put the `google-services.json` you download from the Firebase console in `android/app/`. It is git-ignored; never commit it.

Without that file the app still builds and runs. Push is simply off, the app says so, and nothing crashes. The page checks the app's `pushReady` flag before it asks Android for a push address.

A push that arrives while Orbis is open is shown as a notification too (`presentationOptions` in `capacitor.config.ts`), not only handed to the page.

## Server settings

All four go in Vercel (and `.env.local` if you run the site yourself). `.env.example` has a comment on each.

- **`ORBIS_PHONE_DATA_KEY`**: generate once with `openssl rand -base64 32`. It encrypts the text of each phone signal on the server. **If you lose it, every stored phone signal becomes unreadable.** Keep a copy in a password manager. Do not change it after people have phone data.
- **`FCM_SERVICE_ACCOUNT`**: the base64 of the Firebase service-account JSON: `base64 -w0 service-account.json`. Unset, phones get no push and web push is unaffected.
- **`ANDROID_APP_ID`**: the app's `applicationId` (today `app.orbis.android`, a placeholder you confirm before the first upload).
- **`ANDROID_CERT_SHA256`**: the signing fingerprints, comma-separated, each as `AA:BB:...` (32 pairs). Use two: Play App Signing's SHA-256 (Play Console, Test and release, App signing) and your upload key's (`keytool -list -v -keystore ~/orbis-upload.jks`). Add a third for a debug build if you want passkeys there.

### Check `/.well-known/assetlinks.json`

Open `https://<your site>/.well-known/assetlinks.json`. You should see one entry naming your package and every fingerprint. If you see `[]`, `ANDROID_APP_ID` or a fingerprint is missing or mistyped; the file stays empty on purpose rather than publish half of it. Vercel caches it for an hour.

This file is what lets Android open Orbis links in the app and lets passkeys (the fingerprint unlock) work inside it. For in-app passkeys the passkey RP ID (the website name a passkey is tied to) must also be the site's host (for example `orbis-starter.vercel.app`), not a different domain. Orbis has no setting for it in code: sign-in and unlock call Supabase's passkey functions (`registerPasskey` and friends), so the RP ID is set in your Supabase project's Authentication settings, in its passkey section. Check it there.

## Testing

Run these from the repo root unless a line says otherwise.

```bash
pnpm exec vitest run          # all web and server tests
pnpm exec tsc --noEmit
pnpm lint
pnpm build                    # then undo any change it makes to next-env.d.ts
cd android && ./gradlew testDebugUnitTest assemblePlayDebug assembleDirectDebug
```

**Order matters in CI.** Run `./gradlew assemblePlayDebug` **before** `pnpm exec vitest run lib/native`. That test reads the play build's merged manifest to prove none of the five forbidden permissions got in; with no Gradle build behind it, the check skips quietly instead of failing.

### Tests on an emulator or phone

`./gradlew :orbis-core:connectedDebugAndroidTest` runs the tests that need a real Android (the encrypted store, the key handling).

- **Windows:** start Gradle from a folder on the `C:` drive (for example `cd C:/Users/you/AppData/Local/Temp`, then run `gradlew -p <repo>/android ...`). Android's test runner creates `<drive>:\tmp`, which fails on other drives.
- **Emulator:** boot it with `-gpu host`, for example `emulator -avd orbis_api34 -no-window -no-audio -no-boot-anim -gpu host`. The software renderers (swiftshader and guest) crash the emulator when the site renders. Shut it down with `adb emu kill`.

### Debugging the app

Capacitor logging is off on purpose: its debug log would write the phone's secret and test text into the system log. To see what the page is doing, use WebView DevTools: open `chrome://inspect` in Chrome on your computer with the phone connected, and inspect the Orbis page.

## What the app does, and what to expect

- **Nothing is read until the person turns a source on.** Every source starts off.
- **Turning a source off deletes what Orbis kept from it**, on the phone (its items, its queued signals and its activity counts) and on the server.
- **The sync line.** Once the phone is added, What Orbis can see shows one line under Sources: when the phone last synced ("Last synced 5 minutes ago", or "Not synced yet"), how many items are waiting ("· 3 waiting", left out at none), and, while the last try failed, why ("· Couldn’t sync: unexpected response"). The reasons are "no connection", "HTTP" with a status code (for example "HTTP 503"), "unexpected response", and "this phone’s storage was busy".
- **Auto Backup is off on purpose.** Android's Google Drive backup would copy the phone's local store off the phone, which breaks "raw text stays on the phone". The cost: a person on a new phone starts again and signs in once more.
- **A timed pause and the "Orbis is active" service.** When a pause ends, the service only comes back the next time the app is opened. Android 12 and newer forbid starting it from the background, so open Orbis once after a pause and the notification comes back. The periodic sync keeps running meanwhile.
- **Android 13 and newer hide that notification until notifications are allowed.** The service runs either way. The person must allow notifications to see "Orbis is active".
- **Foreground-service wording for Play.** The service is declared `specialUse`, and Play asks you to justify it. Use the text already in the manifest (`android/orbis-core/src/main/AndroidManifest.xml`): "Personal assistant that applies the user's privacy rules to the phone data they chose to share". In the Play Console form, add: it keeps a visible "Orbis is active" notification, runs only while a source is on, and stops when the person turns everything off or removes the phone.

## Reading notifications

The Notifications source is a Notification Listener (`OrbisNotificationListener` in `android/orbis-core/.../notify/`). Android only starts it after the person switches Orbis on in Notification access; the app cannot grant that itself. On a sideloaded (`direct`) build on Android 13 or newer, Android also hides that switch until "Allow restricted settings" is chosen in App info (three-dot menu). The Play build does not need it.

How an item travels: the listener copies the parts of a notification Orbis may read (`NotificationReader`), runs the privacy rules (blocked apps, contacts and words; masking), drops one-time codes, then `NotificationSorter` labels it `transaction`, `package`, `missed_contact` or `career`, or nothing. The raw text stays in the local encrypted store for 30 days. Only sorted items are queued for sync. Payments land in Money under "From your phone, to review" (`components/money/phone-review.tsx`) and become ordinary transactions only when the person accepts them. The server-side migration is `supabase/migrations/202611140003_phone_transactions.sql`.

Unit tests (`:orbis-core:testDebugUnitTest`) cover the reader, sorter, parser and rules. Anything that needs a real Android is an instrumented test.

### Checking it on an emulator

1. Install a debug build and sign in (see Building above). Turn Notifications on in Settings, Phone access.
2. On an emulator, skip the Settings screens by granting access from the command line:

   ```bash
   adb shell cmd notification allow_listener app.orbis.android/app.orbis.core.notify.OrbisNotificationListener
   ```

   (Use your own app id if you changed it.) On a real phone, use the "Open notification access" button in the app instead.
3. Post a fake bank text:

   ```bash
   adb shell cmd notification post -S bigtext -t "AX-HDFCBK" bank "Rs.1,250.00 debited from A/c XX1234 to SWIGGY"
   ```

   Expected: after the next sync, one row under "From your phone, to review" in Money (amount 1,250, merchant SWIGGY, money out).
4. A text with a code (`"Your OTP is 123456"`) must leave no row anywhere. A delivery text (`"Your order is out for delivery"`) is sorted as `package`. A missed call can only be checked on a real phone: `adb` posts as the shell app, and missed calls are recognised only from the dialer and WhatsApp apps.

The `adb` notifications come from the shell app, not from a banking app, so the default block on banking apps does not apply to them. To test a blocked word, add `HDFCBK` under Blocked words and post again: no new row.

## How the phone and the server talk

- The phone has its own sign-in (a device credential), separate from the person's web session. It calls `/api/device/*`.
- **The phone never touches the web session.** Capacitor shares the WebView's cookies with the phone's own requests, so a sync can carry them. The site ignores them there: `proxy.ts` passes `/api/device/signals`, and `/api/device/revoke` with the phone's credential, straight through without refreshing the session, so a background sync can't sign the person out.
- **Only a JSON reply counts as success.** The phone treats a sync as done only when the server answers with JSON that has the counts it expects. Until `/api/device/*` is deployed, the site answers those paths with a normal web page; the phone keeps its queue, and its sync line in What Orbis can see ends "Couldn’t sync: unexpected response". Nothing is lost.
- **A sign-out is only for the credential that was refused.** If the person signs in again while a sync is out, a late 401 for the old credential is ignored; the new one stays.
- **A push address belongs to one phone.** When a phone sends its push address, any other phone row still holding it (for example, left over from an earlier sign-in on the same handset) loses it.
- **Removed phones sign themselves out.** If the person removes a phone on the web, the server answers it with 401 and the phone then wipes its store and signs out. Only a 401 does this. Errors like 403 (a firewall) or 5xx (a server problem) just make the phone retry later.
- Limits: 100 signals per sync, 4,000 characters per signal, 256 KB per request, 10 active phones per account. The phone keeps raw items 30 days, the activity ledger 90 days, and queues at most 5,000 items.
