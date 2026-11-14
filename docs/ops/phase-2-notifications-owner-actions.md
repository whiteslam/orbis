# Phase 2, part 1: reading notifications (owner steps)

What only you can do to turn on "Orbis reads your notifications" on your phone. The code is written and tested; nothing here happens automatically. Do the steps in order. How to build the app is in [`android.md`](./android.md).

**What it does, in one paragraph.** When you turn Notifications on, Orbis reads the notifications that arrive on your phone, plus bank and UPI text messages from the Messages app (they show up as notifications too). The text stays on the phone, encrypted, for 30 days. Orbis sorts each item. Only the sorted ones leave the phone, encrypted. Payments appear in Money for you to review. Nothing is added to Money until you tap "Add to Money".

**Before you start.** The phone must already be added to your account from Phase 1 ([`phase-1-owner-actions.md`](./phase-1-owner-actions.md)). That means migration `202611120004_devices.sql` is applied, `ORBIS_PHONE_DATA_KEY` is set in Vercel, and Settings, Phone access (the privacy center, "What Orbis can see") shows your phone.

## Steps

1. **Apply the migration `202611140003_phone_transactions.sql`** in the Supabase SQL editor. Open the file in `supabase/migrations/`, copy all of it, paste it into the editor and run it. It is additive and safe to run twice. It lets a payment from your phone be saved in Money, and it makes sure the same payment can never be saved twice.

   Do this **before** you merge or deploy the web side. If the code goes live first, nothing breaks, but "Add to Money" on a phone payment fails until the migration is in.

2. **Build and install the `direct` app** (the version for installing on your own phone) on your phone. The commands are in [`android.md`](./android.md), Building: `assembleDirectDebug` for a test build, or `assembleDirectRelease` for a signed one. Install it with `adb install -r <file>.apk`, then open it and sign in.

3. **On Android 13 or newer, allow restricted settings.** Android blocks notification access for apps you installed from a file instead of from Play. You need to lift that once:
   1. Long-press the Orbis icon, then tap App info (or go to Settings, Apps, Orbis).
   2. Tap the three dots at the top right.
   3. Tap **Allow restricted settings** and confirm with your lock screen.

   If you do not see the three dots, try step 4 first. Android shows them only after it has refused once. The Play Store build does not need this step.

4. **Turn Notifications on.**
   1. In Orbis, open Settings, then Phone access. This is the privacy center ("What Orbis can see").
   2. Under Sources, switch on **Notifications**.
   3. Read the sheet that opens. It says what is read, what is kept and what leaves the phone. Tap **Turn on**.
   4. If Android has not yet given Orbis access, a card says "Orbis can’t read notifications yet." Tap **Open notification access**. Android's Notification access screen opens. Switch Orbis on and confirm.
   5. Go back to Orbis. The card is gone once access is on.

5. **Send yourself a test bank text.** From another phone, or from a friend, send a text that looks like a bank debit. For example: `Rs.1,250.00 debited from A/c XX1234 to SWIGGY`. Do not use a real account number. Then:
   1. Wait for the phone to sync (a minute or two; opening Orbis helps).
   2. Open Money. You should see a card called **From your phone, to review** with the payment on it.
   3. Tap **Add to Money**. The payment moves into your transaction list with a small phone mark ("From your phone"). You can delete it like any other transaction.
   4. Send another one and tap **Not a payment**. It disappears and is not added.

   No emulator or second phone? See "Checking it on an emulator" in [`android.md`](./android.md#reading-notifications).

6. **Block the sender and check the next text is ignored.**
   1. Look at how the test text showed up on your phone: it is under a phone number, a saved contact name or, for a real bank, a name like `AX-HDFCBK`. That is the sender. Block exactly what you see, in Settings, Phone access:
      - a phone number, or a name exactly as it shows (a saved contact, or `AX-HDFCBK`), goes in **Blocked contacts**;
      - or put part of the name in **Blocked words**. A blocked word matches any part of the sender or of the text, so `HDFCBK` blocks `AX-HDFCBK`.
   2. Send another test text from the same sender.
   3. After the next sync, nothing new appears under "From your phone, to review".

   Remove the word again afterwards if you want those texts back.

7. **Check a missed call and a delivery notification are sorted.** Orbis has no screen for these yet, so check them in your account export.
   1. Get a WhatsApp missed call (call yourself from another phone and do not answer), and a delivery notification (for example "Your order is out for delivery" from a shopping app).
   2. Wait for the next sync.
   3. Open Orbis on the website if you can (it is easiest there), go to Settings, Account, and tap **Export my data**. It may ask for your password if you have not signed in within the last 10 minutes.
   4. Open the file and look at the `signals` list. You should find one entry with kind `missed_contact` and one with kind `package`. Their `content` is readable in the export.

## What gets read, and what does not

- **Banking apps are blocked from the start**: SBI, HDFC, ICICI, Axis and Kotak. So are authenticators and password managers. You can change the list under Blocked apps.
- **Bank and UPI text messages from the Messages app are read**, unless you block the sender (step 6).
- **One-time codes are never kept.** A message with a code is dropped before anything is stored.
- Card and account numbers are hidden before anything is stored.
- **Only sorted items leave the phone.** The kinds are `transaction`, `package`, `missed_contact` and `career`. Everything else stays on the phone and is deleted after 30 days.
- **Only payments have a screen so far.** Packages, missed contacts and job mail are stored and sent, but you can only see them in the account export for now.
- **Turning Notifications off deletes what Orbis kept from it**, on the phone and on the server. Payments you already added to Money stay, because they are your transactions now.

## Decisions you can overturn

- **Banking apps start blocked.** The reason is that their notifications hold balances. If you want bank notifications read, untick them under Blocked apps. The list is in `android/orbis-core/src/main/kotlin/app/orbis/core/rules/DefaultBlocklist.kt`; tell Claude if an app is missing.
- **Payments always wait for your review.** Nothing is added to Money on its own. Tell Claude if you want a trusted sender to skip the review.
