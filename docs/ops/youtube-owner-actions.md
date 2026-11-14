# YouTube publishing owner actions

What only you can do to move YouTube posting from the PC publisher (`yt.py` and its timer) into Orbis. The code is written and tested; nothing here happens automatically. Do the steps in this order. The PC timer keeps running until step 9, so no day is skipped while you set up. From step 7 the Orbis schedule is live too, so **you pause Orbis's schedule first (step 5) and switch it back on only after the PC timer is off (step 11)**. Without that, both would post at 18:00 and the same short could go out twice.

Design: `docs/superpowers/specs/2026-11-13-youtube-publishing-design.md`.

**Deploying the code before the migration is safe.** Until step 1 is done, the YouTube panel says posting isn’t set up yet, Connect YouTube asks for the migration, and the publish route does nothing. Nothing breaks and nothing posts; YouTube just shows as not set up.

1. **Apply the migration.** In the Supabase SQL editor, paste and run `supabase/migrations/202611130002_youtube.sql`. It is additive and safe to run twice.

2. **Check the Google web client and its consent screen.**
   - Google Cloud console, project `orbis-512912`, APIs & Services, Credentials, the same web client Gmail uses.
   - Under Authorized redirect URIs, make sure `https://orbis-starter.vercel.app/auth/youtube/callback` is there. Add it if not, and save.
   - Then the OAuth consent screen (Google Auth Platform), **Data access**: Add or remove scopes, and add both YouTube scopes, `https://www.googleapis.com/auth/youtube.upload` and `https://www.googleapis.com/auth/youtube.readonly`. Save. (You may need step 3 first for them to appear in the list; you can also paste them in by hand.)
   - Google hasn’t verified Orbis for these scopes, so when you connect (step 5) Google may show a **“Google hasn’t verified this app”** screen. That is expected for your own app: choose **Advanced**, then **Go to … (unsafe)** (with the app’s name), and carry on. If the app’s publishing status is Testing, the Google account that owns the channel must be listed under Test users (Audience).
   - **Publishing status must be In production** (Google Auth Platform → Audience). In Testing, Google ends every connection after 7 days, so YouTube and Gmail ask to be connected again about once a week.
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` must be set where Orbis is deployed (Vercel). They already are, because Gmail uses them. YouTube uses the same two values, so there is nothing new to add.

3. **Enable the YouTube Data API v3.** In the same project `orbis-512912`: APIs & Services, Library, search "YouTube Data API v3", Enable. Without it, Connect works but every upload is refused.

4. **Deploy Orbis** (merge the `youtube` branch to `main`, so Vercel builds it), and wait for the deploy to finish.

5. **Connect YouTube.** In Orbis, Settings, Connections, **Connect YouTube**. Sign in with the Google account that owns the channel, and allow both permissions (upload videos, and read the channel). The row should then show the channel name. If the account has no channel, Orbis says so and stores nothing.

   Then, still in Orbis, open Social, Shorts, YouTube. Under Schedule, switch **Pause posting** on and tap **Save**. Leave it on until step 11. (**Post now** still works while posting is paused, which step 8 needs.)

6. **Import the old queue, from the home PC** (the Linux one, where the PC publisher lives). Your settings file `~/.config/orbis-shorts/.env` (see `workers/shorts-studio/README.md`) must already hold `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `OWNER_USER_ID`.

   ```bash
   cd <your orbis checkout>
   git pull
   pnpm install
   cd workers/shorts-studio

   # A dry run first. It prints a plan and writes nothing.
   npm run import-youtube-queue

   # When the plan looks right, do it for real.
   npm run import-youtube-queue -- --apply
   ```

   What the dry run prints, one line per project:
   - `would upload: ...` the project will be imported;
   - `skip (published)` the old publisher already posted it;
   - `skip (already queued)` it is in the Orbis queue already (a re-run does this);
   - `unreadable: <reason>` it was left out because a file was missing or didn’t make sense (no `renders/*.mp4`, no `youtube.json`, a privacy that isn’t public, unlisted or private, and so on). Fix the project, or add it in Orbis by hand, then run again;
   - `unreadable: published.json: ...` an entry in the list of already-posted projects couldn’t be read, or none of its names match your projects. **`--apply` refuses to run while this shows**, because a short that is already live could be queued and posted twice. Tell Claude what `published.json` looks like.

   The old publisher’s file formats weren’t available when this was written, so the script reads them tolerantly and never guesses. **Read the plan before you use `--apply`.** If it says `unreadable` for entries that should be fine, tell Claude what the files look like.

   `--apply` is safe to run again. It uploads the newest `renders/*.mp4` and `renders/cover.jpg` of each project to the private `shorts` bucket, then adds the rows to the Orbis queue in the old order. If it stops on an error, run the same command again and it carries on. Then open Social, Shorts, YouTube in Orbis and check the queue order and titles.

7. **Start the scheduler.** In the Supabase SQL editor, run `supabase/cron/youtube_schedule.sql`. It needs the `orbis_cron_secret` vault secret from `supabase/cron/notifications_schedule.sql`, which you already ran. It calls Orbis every 10 minutes; Orbis decides whether anything is due, so most runs do nothing. Set your posting time and days in the Schedule part of the YouTube panel (the default is 18:00 every day, in your time zone). Posting stays paused, so nothing goes out yet.

8. **The live check, once.**
   1. Add one short to the queue and set its privacy to **Private**. Put it first in the queue.
   2. Tap **Post now**. If the upload needs more than one slice, it finishes within about 10 minutes.
   3. Open YouTube Studio and confirm the video is on the channel, private, with the right title.
   4. Delete that video in YouTube Studio.

   If it fails, Posted shows the error. Fix that before step 9. Posting stays paused and the PC timer is still your fallback.

9. **Turn off the PC timer.** Orbis posting is still paused, so for now nothing posts from either side. On the home PC:

   ```bash
   systemctl --user disable --now yt-publish.timer
   ```

   `yt.py` and its files stay on disk as a fallback. If Orbis posting ever breaks, `systemctl --user enable --now yt-publish.timer` brings it back (pause posting in Orbis first, so a day doesn’t get two posts).

10. **Take out of the Orbis queue anything the PC has posted since the import.** The PC timer kept posting from step 6 until you turned it off in step 9. With the timer off, that list can’t grow any more. In Social, Shorts, YouTube, look at the queue and Remove each short that already went out from the PC. Check the PC publisher’s `published.json` (or YouTube Studio) against the Orbis queue if you aren’t sure.

11. **Switch Orbis posting on.** In Social, Shorts, YouTube, Schedule, switch **Pause posting** off and tap **Save**. The schedule now posts one short a day at the time you set.

## Things to know

- **Uploads from an unaudited app stay private.** YouTube keeps videos from apps Google hasn’t audited private, whatever privacy you ask for. Orbis shows "Uploaded as private" on those; make them public in YouTube Studio. Asking Google for the audit is a separate step, not part of this.
- **Quota.** If YouTube’s daily upload quota runs out, Orbis holds the schedule until the next day and tries again.
- **If Google says the connection needs signing in again,** the YouTube panel shows a banner. Settings, Connections, **Reconnect YouTube** (or Connect again in the panel). The queue is kept.
