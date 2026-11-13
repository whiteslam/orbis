# Phase 1 owner actions (Android)

What only you can do to get the Android app from this branch (`android-shell`) onto phones. The code is written and tested; nothing here happens automatically. Do them in this order. How to build and test is in [`android.md`](./android.md).

**Deploy order matters.** Apply migration `202611120004_devices.sql` (step 5) and set `ORBIS_PHONE_DATA_KEY` (step 4) **before** you merge this branch to production. If the code goes live first, nothing breaks, but the phone features wait:
- `/api/device/signals` answers 503 or 500, phones keep retrying, and no data is lost, but nothing syncs until both are in place;
- on the web, Settings, What Orbis can see stays empty ("No phones yet"), and its "Delete what Orbis kept" buttons have nothing to delete;
- an account export leaves the phone tables out, without a "could not be read" note.

1. **Confirm or replace the app id `app.orbis.android`.** It is a placeholder and it is permanent on Play once you upload the first build. Pick the final one now (a reverse web address you control, like `in.yourname.orbis`). To change it, edit these together, then run `npx cap sync android`:
   - `applicationId` in `android/app/build.gradle`;
   - `appId` in `capacitor.config.ts`;
   - in `android/app/src/main/res/values/strings.xml`, both `package_name` and `custom_url_scheme` (today both hold `app.orbis.android`).

   Leave `namespace` in `android/app/build.gradle` alone. It is the name of the Kotlin and Java code (`MainActivity`, the plugin, the generated files), not the app's id on Play, and changing it breaks the build.

   Whatever you choose must also match: `ANDROID_APP_ID` in Vercel (step 4), the Android app you add in Firebase (step 3), and so `/.well-known/assetlinks.json`.

2. **Create the Google Play developer account.** Decide organisation or personal first (spec section 9). An organisation account needs a D-U-N-S number (a free business ID from Dun & Bradstreet that Google uses to verify companies); check whether Orbis's Money and Health features need that. A personal account must run a closed test (a Play trial with a fixed group of testers) with about 12 testers for 14 days before going public (step 6).

3. **Create the Firebase project.**
   - Firebase console: new project, then add an Android app with the app id from step 1.
   - Download `google-services.json` and put it in `android/app/` on your computer. It is git-ignored; never commit it.
   - Project settings, Service accounts, Generate new private key. Keep that JSON file private (it is also git-ignored).

4. **Set four values in Vercel**, then redeploy. Each is explained in [`android.md`](./android.md) and `.env.example`.
   - `ORBIS_PHONE_DATA_KEY`: `openssl rand -base64 32`. Back it up. Losing it makes stored phone signals unreadable.
   - `FCM_SERVICE_ACCOUNT`: `base64 -w0` of the service-account JSON from step 3.
   - `ANDROID_APP_ID`: the id from step 1.
   - `ANDROID_CERT_SHA256`: the fingerprints that identify the app's signatures, comma-separated: Play App Signing's SHA-256 (the key Google re-signs your app with after upload) plus your upload key's (the key you sign each upload with; made in [`android.md`](./android.md), Release signing). You only get Play's after step 6's first upload, so set your upload key's now and add Play's afterwards. Then open `/.well-known/assetlinks.json` and check it is not `[]`.

5. **Apply migration `202611120004_devices.sql`** in the Supabase SQL editor. It is additive and safe to run twice.

6. **Upload to the internal testing track** (Play's first, small test group, available within minutes, before closed and public tests).
   - Build with `./gradlew bundlePlayRelease` and upload the `.aab` (the bundle file Play requires instead of an APK) in Play Console, Testing, Internal testing.
   - If the account is personal, start the closed test now: 12 testers, 14 days. The clock only runs while they stay opted in.

7. **Tell Claude the test phones** (make, model, Android version). Include at least one Samsung and one Xiaomi or Redmi, and a Pixel if you have one. Phase 1 is not done until these are checked.

8. **The 48-hour check on a Samsung and a Xiaomi phone.** Install the `direct` build (`assembleDirectRelease`), sign in with your email and password or a passkey (Google sign-in is hidden inside the app), turn the Test source on, and leave the phone alone for two days. Then check:
   - the "Orbis is active" service is still running and its notification is shown (on Android 13 and newer, only if notifications are allowed);
   - a sync happened in the last hour: in What Orbis can see, the line under Sources reads "Last synced … ago" with an hour or less, and does not end in "Couldn’t sync: …" (a "· 3 waiting" part is fine right after you use Try it);
   - battery use is under about 3% a day (Settings, Battery);
   - **Phase 2, skip for now:** a notification from Private Space or Secure Folder never shows in Recent activity. Phase 1 has no notification source, so there is nothing to see yet; check it once the Notifications source ships.

9. **Review the privacy policy wording for phone data** (`app/privacy/page.tsx`). Phase 1 ships the per-user encryption of phone signal text, but not embeddings and not real phone signals beyond the Test source. The policy should say what exists, not what is planned. Also keep the DPDP consent wording and the Play Data safety form in step with it.

10. **Run the end-to-end check on staging.** It was not run during the build: no staging Supabase project exists, and the local site talks to production, where test accounts must not be created. You need a staging Supabase project ([`staging.md`](./staging.md)) or a local Supabase, with this branch's migrations applied and `ORBIS_PHONE_DATA_KEY` set there.
    1. Point a debug build at your staging site (`ORBIS_URL=... npx cap sync android`) and sign in on the emulator against staging, with email and password or a passkey (Google sign-in is hidden in the app).
    2. In What Orbis can see, turn the Test source on.
    3. Send the text "Your OTP is 123456", plus one blocked item of each kind (a blocked app, a blocked contact, a blocked word).
    4. In the staging database, check there is exactly one `signals` row for it, and that its `content` starts with `p1.` (that is the encrypted form; the readable text must not appear anywhere).
    5. Remove the phone on the web (Settings, What Orbis can see). After the phone's next sync, the app must be signed out with an empty store.

## Decisions you can overturn

Each was made while building so the work could continue. Tell Claude if you disagree and it will change it.

- **P1, the phone's own sign-in.** The phone holds a device credential instead of your web session, so a lost phone can be removed without signing you out everywhere, and a stolen phone never holds your account password or tokens. This replaces the spec's "hand over the session tokens".
- **P5, `app.orbis.android` is a placeholder.** See step 1.
- **R10, removing a phone is permanent.** A removed phone cannot be switched back on, even by you. To use it again, add it as a new phone. This stops a stolen web session from reviving a removed phone.
- **R13, push addresses.** Only Firebase's "UNREGISTERED" error clears a phone's push address. A plain 404 does not, because a wrong project in `FCM_SERVICE_ACCOUNT` would otherwise wipe every phone's address.
- **R17, masking.** Masking also hides codes after the words "verify" or "PIN" (and password, CVV), and joined digit groups like "123 456". Dates and times stay readable. The cost is a little over-masking of ordinary numbers in those texts.
- **R19, only a 401 signs a phone out.** A 403 (for example from a firewall) makes the phone retry, not wipe itself.
- **R22, a removed phone is not re-added silently.** After you remove a phone on the web, it shows "removed" and waits for you to tap "Add this phone again".
- **The default blocklist.** Notifications from these apps are blocked from the start. Review the list (`android/orbis-core/src/main/kotlin/app/orbis/core/rules/DefaultBlocklist.kt`) and tell Claude what to add or drop; it is ticked for India-first use and is thin on UPI and delivery apps.
  - Authenticators and password managers: `com.google.android.apps.authenticator2`, `com.azure.authenticator`, `com.authy.authy`, `com.x8bit.bitwarden`, `com.onepassword.android`, `com.lastpass.lpandroid`, `com.dashlane`, `com.callpod.android_apps.keeper`.
  - Banks: `com.sbi.lotusintouch`, `com.csam.icici.bank.imobile`, `com.axis.mobile`, `com.msf.kbank.mobile` (old Kotak app), `com.kotak.bank.mobile` (current Kotak app), `com.hdfcbank.android.now`.

## A process note

During the emulator check of the phone plugin (Task 11), one masked test signal ("Your OTP is [code]") was sent to production's `/api/device/signals`. That route is not deployed there yet, so nothing stored it, and no account was created. It showed that production answers that path with a normal web page, which is why the phone now counts only a JSON reply as success.
