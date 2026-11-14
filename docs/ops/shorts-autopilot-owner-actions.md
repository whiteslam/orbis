# Shorts autopilot: owner steps (the shelf)

What you do once so the home PC makes bedtime stories overnight, one at a time, and keeps a few days of posts ready for YouTube. Design: `docs/superpowers/specs/2026-11-14-shorts-shelf-and-reels-design.md` (part 1).

1. **Apply the migrations in Supabase** (SQL editor, in this order). Run `supabase/migrations/202611140001_shorts_autopilot.sql` first if it isn't applied yet. Then run `supabase/migrations/202611140002_shorts_shelf.sql`. Both are safe to run twice. The second one moves your autopilot to build between 23:00 and 07:00.
2. **Update the home PC and restart the worker.** In the Orbis folder on the Linux PC, run `git pull`, then `systemctl --user restart orbis-shorts`. Check it with `journalctl --user -u orbis-shorts -f`. Once the window opens, a line like `Autopilot queued (youtube): …` appears.
3. **Keep the PC awake during the window.** In the power settings, set automatic suspend to **never**, or at least not between the window times. To check, run `systemctl status sleep.target`: it should say `inactive`. A sleeping PC builds nothing, and a missed night shows as a shorter shelf on the health card.
4. **Set the autopilot.** Go to Social → Shorts → Autopilot. Set:
   - **Build between** (default 23:00 and 07:00);
   - **Keep ready** (1–7 days, default 3);
   - **Post to**: YouTube.

   The PC builds until the YouTube queue holds that many days of posts. Your YouTube schedule's post times count as posts a day.
5. **Check Google's publishing status.** In Google Cloud → Google Auth Platform → Audience, the publishing status must be **In production**. In Testing, Google ends the YouTube and Gmail connections every 7 days.

Afterwards, the **How it’s running** card at the top of Social → Shorts shows:
- the shelf;
- the next post;
- the PC;
- the accounts;
- problems from the last 24 hours.

Amber or red lines are the ones to look at.
