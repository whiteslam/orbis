# Career: Orbis runs the job hunt

Date: 2026-10-27 · Status: approved to build (the owner handed every remaining call to the builder) · Scope: product, system design and architecture for a new Career tab.

## Why

The owner wants Orbis to work like a personal recruiter that never sleeps. Today they search LinkedIn, Indeed, Naukri and a growing number of startup and remote boards by hand. They rewrite the same resume for each job and lose track of who replied. What they asked for, in their words:

- keep the resume on file all the time;
- take a spec of the job they want and search for matching jobs automatically, including the startup and remote boards where new jobs land daily;
- read each job's requirements, and when the resume matches more than 50%, reshape the resume around that job, ATS-friendly every time, and prepare a crisp "this is me" note;
- **ask for approval; the owner presses Send; then it sends** (their decision);
- keep a record of every application: did they reply, was there an interview call or not;
- when a company replies or makes an offer, notify them, and advise from their experience and skills whether to negotiate salary or ask for other things;
- predict what it can ("predict some kind of a future"), and feel like Jarvis.

They also lifted the AI budget cap and the rule that personal data may only reach providers that don't train on it. Capability comes first (see "AI policy change").

"Office things" (the current job) came up once and was not described. It is a separate, later project, and is out of scope here.

## Success

1. Setting up takes one sitting. Upload a resume, describe the job, and Orbis has a structured profile and spec it shows back for confirmation.
2. Every day, without being asked, new matching jobs appear with a score, the reasons behind it, and what's missing.
3. For a job at or above the threshold, a tailored ATS-safe resume (PDF and DOCX), cover note and screening answers are ready to review. Nothing in them is untrue.
4. One press of Send applies wherever Orbis legitimately can. Everywhere else, one tap opens the apply page with everything ready to paste.
5. Replies, interview invites, rejections and offers found in Gmail move the application along on their own, and interviews and offers notify the owner.
6. An offer comes with a clear verdict, what to ask for, and a reply draft ready to send.
7. The Insights view shows forecasts and the skill gaps that hold the owner back. Every number says how sure it is.

## Anti-goals (a failure even if it works)

- **Inventing anything.** A skill, employer, title, date, number or degree that isn't in the owner's profile must never appear in anything sent. A tailored resume that lands an interview the owner can't back up is worse than no application.
- **Sending without the press.** No route sends an application, follow-up or negotiation reply unless the owner pressed Send on that item.
- **Getting the owner's accounts banned.** No browser bots, scraping or automated applying on LinkedIn, Indeed, Naukri, Instahyre, Cutshort, Hirist, Foundit or Wellfound. Their terms forbid it, and LinkedIn and Indeed restrict accounts that do it. These are read only through the owner's own job-alert emails, and applied to by the owner clicking through.
- **Confident fake numbers.** Predictions with too little data say so ("early estimate" and a range). They never show a bare percentage as if it were known.
- **Noise.** Notifications are reserved for interview invites, offers and recruiter questions waiting on the owner. Everything else waits in the tab.

## Glossary

| Term | Meaning |
|---|---|
| **Profile** | The owner's structured career record, parsed from the master resume and edited by them: contact, roles, education, certifications, projects, skills and **facts**. |
| **Fact** | One true, atomic statement from the profile ("Cut p95 latency from 900 ms to 250 ms at Acme, 2024"), with a stable id. Every tailored bullet cites the facts it rests on. |
| **Spec** | What the owner is looking for: target roles, seniority, locations or remote, time zones, salary floor and target, company stage, must-haves, deal-breakers. |
| **Job** | One listing, normalised from any source and de-duplicated across sources. |
| **Requirements** | What a job asks for, extracted once by AI into a fixed shape. |
| **Match** | The deterministic score (0–100) of profile against requirements, with every point explained. |
| **Application** | One job the owner is pursuing, from the tailored draft through sending, the replies and the outcome. |
| **Event** | Something that happened to an application: sent, reply, interview invite, assessment, rejection, offer, follow-up, note. |
| **Route** | How an application leaves Orbis: `email` (from the owner's Gmail), `recruitee` (the Recruitee careers API) or `link` (the owner applies on the site; Orbis prepares everything). |

## Sources

What was verified on 2026-10-27, and how each source is used:

| Source | How Orbis reads it | Apply route | Conditions |
|---|---|---|---|
| LinkedIn, Indeed, Naukri, Instahyre, Foundit, Wellfound, Cutshort, Hirist | The job-alert emails in the owner's Gmail | `link` | Never scraped or fetched. Only what the email says is used. |
| Himalayas | `https://himalayas.app/jobs/api/search` (JSON). Optional `HIMALAYAS_API_KEY`. | `link` via `applicationLink` | Show "via Himalayas". Re-sync daily at most. |
| Remotive | `https://remotive.com/api/remote-jobs?search=` | `link` | At most 4 fetches a day. Show "via Remotive" and link back. |
| RemoteOK | `https://remoteok.com/api` | `link` | Credit "Remote OK" with a followed link back. Never use its logo. |
| We Work Remotely | RSS feeds (`https://weworkremotely.com/categories/<category>.rss`, plus the all-jobs feed) | `link` | Link back to WWR. |
| Jobspresso | RSS at `https://jobspresso.co/?feed=job_feed` | `link` | Link back. |
| Hacker News "Who is hiring" | Algolia: the latest `story,author_whoishiring` story, then its comments | `email` when the comment gives an address, else `link` | Free, no key. |
| Adzuna | `https://api.adzuna.com/v1/api/jobs/<country>/search/1` with `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` (default country `in`; others from the spec) | `link` | Show "Jobs by Adzuna". Stands down without keys. |
| Company watchlist | Greenhouse `boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true`, Lever `api.lever.co/v0/postings/<site>?mode=json`, Ashby `api.ashbyhq.com/posting-api/job-board/<name>`, Recruitee `<co>.recruitee.com/api/offers/` | `recruitee` for Recruitee, else `link` | The owner adds the company slugs. |
| Pasted job | The owner pastes a URL or the description | Depends on what's pasted | A Greenhouse, Lever, Ashby or Recruitee URL is read from its API. Any other URL is used only as the apply link, and the owner pastes the text. |

Each source is a module with a pure `parse(raw) → NormalizedJob[]` (unit-tested on saved fixtures) and a thin fetch wrapper. That wrapper sends a descriptive User-Agent, respects the limits above, and returns an empty list on any error. One failing source never stops the others.

**Job-alert emails** (their formats are not verified, so parsing must not depend on one layout):
1. The Gmail query covers the known alert senders (LinkedIn `jobalerts-noreply@linkedin.com` and `jobs-noreply@linkedin.com`, Indeed `alert@indeed.com` and similar, Naukri `naukri.com`, Instahyre, Foundit, Wellfound, Cutshort, Hirist) plus `subject:(job alert OR jobs for you OR recommended jobs)`. The sender list lives in one table in code.
2. The full message is read (`format=full`). From its HTML, every `<a href>` is pulled out with its visible text, nearby text and the plain-text body.
3. Per-sender URL patterns spot job links (for example `linkedin.com/(comm/)?jobs/view/<id>`, Indeed `jk=<id>`, `naukri.com/job-listings-`). The job id gives a stable dedupe key.
4. AI turns each spotted link and its nearby text into `{title, company, location, url}`. When no pattern matches, AI reads the whole email and returns the jobs it finds, each tied to one of the email's real URLs. A URL the AI invents is dropped.
5. These jobs are **thin**: the email carries a title and a line, not the description. They are scored on what is known and marked "thin". The owner can paste the full description to rescore one, and is asked to before tailoring.

## Pipeline

```
sources ─┐
alerts ──┼─► normalise ─► dedupe ─► prefilter ─► extract requirements (AI) ─► match (rules)
pasted ──┘                                                                       │
                       ┌──── below threshold: shown in "Everything", greyed ─────┤
                       ▼                                                         ▼
              owner shortlists ◄──── at/above threshold: "For you" ──► auto-draft (AI) ─► truth check ─► ATS check
                                                                                                  │
                                                     owner reviews, edits, presses Send ◄─────────┘
                                                                          │
                                       route: email / recruitee / link (owner marks applied)
                                                                          │
                     Gmail watcher ─► classify reply ─► link to application ─► event ─► status ─► heads-up/push
                                                                                         │
                                                                    offer ─► advisor ─► reply draft ─► Send
```

### Dedupe
- Each job gets `dedupe_key = normalise(company) + '|' + normalise(title) + '|' + normalise(location bucket)`. Normalising lowercases, strips punctuation and drops company suffixes (`inc`, `ltd`, `pvt`, `technologies`…). The key is unique per user.
- A second sighting from another source adds its URL to `sources` and keeps the richer description.
- Jobs older than 45 days, or from listings that have closed, are hidden. They are never deleted while an application points at them.

### Prefilter (before any AI)
Most feed items are irrelevant (RemoteOK alone returns hundreds). A job goes on to extraction only when its title shares at least one meaningful token with a target role or its synonyms, and no deal-breaker word appears in its title. Synonyms are a small built-in map ("frontend" ~ "front-end" ~ "ui engineer", "sde" ~ "software engineer", …) plus any the owner adds. Jobs that fail stay stored, scored 0 and labelled "not your role".

### Requirements extraction (AI, once per job)
- The AI is given the description (capped at 12k characters) and returns JSON:
  - `mustHave[]` and `niceToHave[]`, each `{skill, years?}`
  - `minYears`, `seniority`, `education`
  - `locationPolicy` (`remote`, `hybrid` or `onsite`, plus where)
  - `timezones`, `salary {min, max, currency, period}?`, `employmentType`
  - `visa`, `applyEmail?`, `screeningQuestions[]`
- The reply is validated in code, and an invalid one tries the next model. The result is stored with a `version` so a later prompt change can re-extract.

### Match (deterministic, pure, tested)
- Skills are compared after normalising through an alias map and stemming. A profile skill counts only if a fact or role backs it (evidence). Each requirement gets one of:
  - `met`: the evidence includes years, when years are asked;
  - `partial`: the skill is present but with fewer years, or only a closely related skill;
  - `missing`.
- `score = 60 × mustCoverage + 20 × niceCoverage + 10 × experienceFit + 10 × roleFit`. `partial` counts 0.5. With no must-haves listed, their 60 points move to `niceToHave`, or to `roleFit` when there are no nice-to-haves either. The total is rounded to an integer.
- The spec's hard filters run separately. A failed one (deal-breaker, location or remote mismatch, a known salary max below the owner's floor) marks the job `excluded` with the reason, whatever its score.
- Default threshold 50, editable (30–90). At or above it, the job is **For you** and gets an auto-drafted application. Below it, the job stays visible under **Everything**, where the owner can still shortlist and draft it.
- Thin jobs are scored with confidence `low`.

### Tailoring (AI, quality model)
- Input:
  - the profile, with every fact listed by id;
  - the job and its requirements;
  - the spec, for tone and salary context;
  - which requirements are met.
- The AI returns **only content, never structure**: a headline, a summary, an ordered skill list, and per role id up to 6 bullets `{text, factIds[]}`. It also returns project bullets, a cover note of at most 180 words with `factIds`, answers to the job's screening questions and the common ones (notice period, expected salary as a range from the spec, why this company, years with X), and a short outreach note for a recruiter.
- The renderer takes names, employers, titles, dates, education and contact details **from the profile**, never from the AI.
- **Truth check** (pure, tested; it runs before anything is shown):
  - every `factId` must exist;
  - every number, percentage or currency amount in a bullet must appear in one of its cited facts;
  - every skill listed must be in the profile (after aliases);
  - nothing may name an employer, degree or certification the profile doesn't have.
  
  A bullet or skill that fails is removed and listed under "Removed because it couldn't be backed up". If more than a third fails, the draft is regenerated once.
- **ATS check** (pure plus pdfjs):
  - the PDF is rendered, its text is read back with pdfjs, and the check confirms the contact line, standard section headings (Summary, Skills, Experience, Education) and every role title come back in order;
  - it reports keyword coverage (the job's terms found in the resume text) and flags anything over 2 pages.
  
  It produces a pass/fail report with fixes.
- **Formats:** PDF via `pdf-lib`, with Helvetica and text cleaned to WinAnsi (₹ becomes "INR"). DOCX via the `docx` package. Both are one column, with no tables, images or text boxes. Files go to the private bucket `career-documents` at `<userId>/applications/<applicationId>/resume-<n>.pdf|docx`.

### Approval and sending
- The **Queue** shows each drafted application:
  - the score and its reasons;
  - a diff of what changed from the master resume;
  - the editable cover note and answers;
  - what the truth check removed and the ATS report;
  - the route.
  
  Editing any text re-runs the truth check on that text. A new number the owner types is allowed, because it's theirs, but it's highlighted.
- **Send** is a server action. It re-reads the application, checks its owner and that its status is `ready`, and moves it to `sending` with a conditional update so a double press sends once. It enforces a daily cap (default 25, editable), then takes the route:
  - `email`: a MIME message from the owner's Gmail to the job's apply address, with the tailored PDF attached and the cover note as the body. This needs the `gmail.send` scope; see "Gmail send". The returned thread id is stored.
  - `recruitee`: a multipart POST of the candidate's name, email, phone, cover letter and the PDF to `https://<co>.recruitee.com/api/offers/<slug>/candidates`. The exact payload isn't verified. Any non-2xx reply falls back to `link`, and the owner is told.
  - `link`: the apply page opens in a new tab. A side panel has copy buttons for every field, the downloads and the screening answers. The application waits in `opened` until the owner presses "I applied". Only then does it count as sent.
- After sending: the status is `sent`, a `sent` event is recorded, the prediction is snapshotted, and `follow_up_due` is set to 7 days later for the `email` and `recruitee` routes.

### Gmail watcher (cron, every 15 minutes)
- It runs for each user with a career profile and a working Google connection, reading at most 25 messages a run, newest first, from the last 3 days. Each message id is handled once, using a `career_mail` table.
- **Job alerts** (sender in the alert list) go to alert parsing (above).
- **Candidates for a reply** are messages that are:
  - in a thread Orbis sent; or
  - from the domain of a company with an open application; or
  - whose subject or snippet matches a hiring vocabulary (interview, application, assessment, shortlisted, offer, unfortunately, next steps, recruiter…) **and** names a company with an open application.
  
  Everything else is skipped without reading the body.
- **Classifying.** For a candidate, the plain-text body (capped at 8k characters) is classified by AI as JSON:
  - `kind`: one of `acknowledgement`, `rejection`, `interview_invite`, `assessment`, `recruiter_question`, `offer`, `other`;
  - `company`, `role`;
  - `interviewAt` (ISO with time zone, if stated), `interviewFormat`, `meetingLink`;
  - `offer {fixed, variable, joiningBonus, equity, currency, period, startDate, deadline}`;
  - `needsReply`, `summary` (at most 160 characters).
  
  Rules check it afterwards:
  - an offer must contain an amount or the word offer;
  - a rejection may not also be an offer.
- **Linking.** A thread id match wins. Otherwise the sender domain is matched against the company's domains (from its apply email and URLs). Otherwise the company name is fuzzy-matched against open applications. A reply that can't be linked lands in an "Unmatched replies" list the owner can attach.
- **Status only moves forward:** `sent < acknowledged < replied < assessment < interview < offer`. `rejected` is allowed from any stage before `offer`. `withdrawn`, `accepted` and `declined` are set only by the owner.
- **Notifications.** Interview invites, offers and recruiter questions create heads-ups (kinds below, `urgent`), which reach the owner through the existing push path and its caps.

### Follow-ups and ghosting
- On the day `follow_up_due` arrives, with no reply yet, Orbis drafts a short follow-up in the same Gmail thread. A `career.follow_up` heads-up (normal urgency) opens it, and it is sent only on Send.
- With no reply 21 days after sending (editable), the application is marked `ghosted`. A later reply revives it.

## Intelligence

All of it is pure and tested, in `lib/career/predict.ts` and `insights.ts`.

- **Reply chance per application.** A logistic model:
  - **Prior coefficients** (written down and explained in code): route (email > recruitee > link), match score, freshness (days from posting to applying), salary fit, seniority fit, thin vs full description.
  - **Learning.** Once there are 15 or more resolved applications (a reply of any kind, a rejection, or ghosted), the model is refit on the owner's own outcomes with L2-regularised gradient descent and blended with the prior by `n / (n + 30)`.
  - **Display.** It shows a range (±1.96 × an approximate standard error) and the label "early estimate" while n < 15.
- **Interview chance.** The same approach applied to interview outcomes.
- **Pipeline forecast.** The expected replies and interviews in the next 14 days, from the open applications' chances spread over the time to reply observed so far (a fixed prior until there is data).
- **Apply-fresh advice.** It reports the reply rate by freshness bucket once there is data, and otherwise the prior: "apply within 2 days of posting".
- **Skill-gap radar.** For each missing must-have that recurs across scored jobs, it rescores those jobs counterfactually with that skill added. It reports how many more would cross the threshold ("Adding Kubernetes would put 14 more jobs above your bar"). This is exact, not a guess.
- **Salary pulse.** The p25, p50 and p75 of the stated salaries in the owner's role, per currency and period, from stored jobs (and Adzuna when its keys are set). It sits beside the owner's floor and target, with the sample size.
- **Market pulse.** Matching jobs per week over the last 8 weeks, and which sources produce the best matches and replies.
- **Best day to apply.** Shown once there are 30 or more sent applications. Until then the card says how many more are needed.

## Offers

- An offer event, or one the owner enters by hand, creates a `career_offers` row with the compensation parsed. The owner confirms or corrects it before any advice is given.
- **Advice** (AI, quality model, structured) is built from:
  - the offer;
  - the spec's floor and target;
  - the salary pulse;
  - the owner's experience (years, seniority, standout facts);
  - other live interviews and offers, which are leverage.
- The advice gives:
  - a `verdict` (`accept`, `negotiate` or `walk_away`) and its reasons;
  - `asks[]`: base, joining bonus, notice-period buyout, equity, remote, title, start date or learning budget, each with an amount or wording and the reason;
  - `risks[]`;
  - a reply draft to the recruiter.
- **Guard in code:** a counter above 25% over the offer is capped, unless the market p75 or a competing offer supports it, and the cap is said aloud.
- The reply draft is sent from Gmail only on Send.

## Interview prep

An `interview_invite` event creates a prep pack (AI, quality model):
- **Logistics:** time in the owner's zone, format, link.
- **What they'll likely test,** from the requirements.
- **Story map:** each likely topic matched to the owner's facts, written as STAR prompts.
- **Questions to ask.**
- **Gaps to prepare for:** the missing or partial requirements, with an honest framing.

The prep pack is shown on the application. Talk to Orbis can run a mock interview from it later; that is not in this build.

## Screens

Career is a sixth bottom-nav tab (`career`, Briefcase icon, `#career`). The nav must fit six at 360 px wide: labels shrink and icons stay.

Inside the tab, a segmented control switches between five views:

1. **For you** (the default): new matches at or above the threshold, as cards showing title, company, source credit, score ring, the top 3 met and the top missing, salary if known, freshness, and a "thin" badge where it applies. Actions: Open, Shortlist, Not for me (with an optional reason, used to learn synonyms and deal-breakers later). There is an "Everything" toggle and a "Paste a job" button.
2. **Queue:** drafted applications waiting for approval. The application sheet (described above) holds Send. A badge shows the count.
3. **Tracker:** applications grouped by stage (Sent, Replied, Interview, Offer, Closed), each with its event timeline, the latest summary, reply chance and next step. "Unmatched replies" sits at the top when there are any.
4. **Insights:** the forecast, skill-gap radar, salary pulse, market pulse and best-day card, each with its confidence.
5. **Setup:**
   - **Resume:** upload a PDF or DOCX. It is parsed by AI into the profile, which is shown as editable sections with facts. Re-uploading merges, and never silently drops a fact the owner edited.
   - **Spec:** describe it in a sentence, then edit the fields.
   - **Sources:** toggle each source and edit the company watchlist.
   - **Settings:** threshold, daily cap, follow-up days, ghost days.
   - **Connection:** the Gmail connection's state and the "Allow sending" button.

### The web panel (`/active/career`)

The owner asked for a full web version as well, laid out like the Rapport CRM demo they pointed to (`demo.codeandchill.store/rapport`), but in Orbis's own look. That demo is a paid template, so only its layout ideas are borrowed. Its code, images, wording and brand are not copied.

A CRM maps well onto a job hunt: deals become applications, customers become companies, the schedule becomes interviews, finance becomes offers and salary, and growth becomes insights.

**Placement and access.**
- The route is `app/(orbis)/active/career/page.tsx`. It sits under `/active/`, so `proxy.ts` already sends anyone signed out to the login page.
- The page repeats `active/page.tsx`'s session, allowlist, lock and PIN checks. The checks move into one shared helper so the two pages can't drift apart.
- It isn't linked from public pages and is marked noindex.
- The phone app's Career tab has an "Open full panel" link to it, and the panel links back to the app.

**Look: Orbis, not Rapport.**
- Dark by default, with light following the existing theme switch. DM Sans, the brand tokens from `brand.css`, 16 px card radii and the teal-to-blue gradient for primary actions.
- Stage colours come from the brand: `--brand-gold` (Found), `--brand-blue` (Ready), `--brand-teal` (Sent), `--brand-green` (Interview), the gradient (Offer) and `--sys-surface-3` (Closed).
- Every colour is a token, so both themes keep their contrast.

**Layout (desktop first; it reflows to one column below 900 px with no sideways scrolling):**
- **Header:** the Orbis mark plus "Career". The centre holds pill navigation: Overview · Pipeline · Jobs · Interviews · Offers · Insights · Setup (hash routes such as `#/pipeline`, so links and the back button work). On the right sit an unmatched-replies inbox button, a notifications button with a count, and the owner's initial.
- **Left rail:** a floating vertical bar of quick actions. Search (`/` or Ctrl+K opens a command palette over jobs, companies and applications), Paste a job, Run a search now, Open the queue, Export the tracker as CSV, Theme, and Back to the app.
- **Page title row:** a large two-line title ("Job / Pipeline") with three key numbers beside it, each with an icon disc. On Overview these are applications this week (with the change from last week), interviews booked, and the reply rate.
- **Overview** is a grid of cards:
  - Applications over time: an area chart of sent applications per week, with replies and interviews overlaid, over 8 or 26 weeks.
  - **Hot matches:** the top 6 unapplied matches as bold stage-coloured cards showing title, company, score, salary and freshness.
  - **Weekly goal:** a ring of applications sent against the weekly target (a new setting, default 15) and the pace needed for the rest of the week.
  - **Stage mix:** a segmented bar and table of counts per stage.
  - **Predictions:** the 14-day forecast, with replies and interviews as ranges.
  - **Today:** interviews and follow-ups due, as a checklist, with "Coming up" below.
  - **Recent activity:** the latest events.
- **Pipeline:** a kanban board with columns Ready → Sent → Replied → Interview → Offer, and drop zones for Accepted and Closed (rejected, ghosted, withdrawn). It has search, a source filter, a Board/List toggle and a CSV download.
  - Cards are coloured by stage and show the job, company, score, reply chance, the last event and its date.
  - Dragging a card moves it only through the transitions the owner is allowed to make by hand (withdraw, accept, decline, "I applied", mark interview). Gmail moves cards forward by itself. Every drag has a keyboard alternative through the card's menu.
- **Jobs:** the For you / Everything list from the tab, as a wider table-and-card view with filters (source, score, remote, salary, fresh) and the application sheet as a side drawer.
- **Interviews:** an agenda of upcoming interviews with their prep packs, and past ones with outcomes.
- **Offers:** offer cards with the compensation breakdown, the market comparison chart (p25/p50/p75 against the offer) and the advisor's verdict, asks and reply draft.
- **Insights:** the skill-gap radar, salary pulse, market pulse, source performance and best day to apply.
- **Setup:** the same sections as in the tab.

**Shared code.** The tab and the panel share the same server actions, data loaders and building blocks: the application sheet, the job card core, charts and the status chip. The panel's own components live in `components/career/panel/`, and its styles in `app/styles/career-panel.css`. Charts use the `recharts` already installed.

Today gets a row from `lib/focus/career.ts`. It reads the most important of: an interview within 24 hours, an offer waiting, N applications waiting for approval, or N new matches. It opens the Career tab.

## Gmail send

- The Google connection stays read-only unless the owner turns sending on. "Allow sending applications" in Career Setup starts the existing Google OAuth with `gmail.send` added to the scopes. A query flag on the start route selects this, and `include_granted_scopes` keeps the current scopes.
- `granted_scopes` shows whether sending is on.
- Without the send scope, the `email` route becomes "Open in Gmail": a Gmail compose URL prefilled with the recipient, subject and body. The owner attaches the downloaded PDF, sends, and presses "I applied".
- The privacy page and terms must say exactly this: Orbis sends only messages the owner approved, from their account.
- The owner must also add `gmail.send` to the app's OAuth consent screen in Google Cloud. That is listed in the handover, not done by the builder.

## AI policy change (the owner's decision)

- **Budget.** The ₹300/₹500 monthly cap stops limiting by default. With `ORBIS_AI_MONTHLY_BUDGET_INR` unset or `0`, there is no cap and paid models go first for quality features. A positive value restores the cap. Spend is still logged per attempt.
- **Personal data.** It is no longer limited to `may_train = false` providers. `sensitivity` stays on requests for logging, and the router no longer filters on it.
- The privacy page says this plainly.
- This is a separate commit so it can be reverted on its own.
- **Features.** The career features are `career_profile`, `career_requirements`, `career_tailor`, `career_mail`, `career_offer` and `career_prep`:
  - `career_tailor`, `career_offer`, `career_prep` and `career_profile` join `QUALITY_FEATURES`;
  - extraction and mail classification go through the normal order;
  - each also gets an entry in `AiQuotaFeature`, with daily credits high enough for a few hundred jobs a day.

## Data

This is one migration, `202610270001_career.sql`, written to the house conventions:
- idempotent;
- `user_id` cascades;
- RLS enabled with `revoke all`, narrow grants, and policies of the form `(select auth.uid()) = user_id`;
- `set_updated_at` triggers;
- appended to `pending.sql`.

| Table | Purpose |
|---|---|
| `career_profiles` | One row per user. `profile jsonb` (validated in code), `resume_path`, `resume_text`, `spec jsonb`, `settings jsonb` (threshold, daily cap, follow-up days, ghost days, sources on/off, watchlist, synonyms), `last_ingest_at`, `source_cursors jsonb` (per-source last fetch, for the polling limits), `last_mail_scan_at`. |
| `career_jobs` | `source`, `source_ref`, `dedupe_key` (unique per user), `title`, `company`, `location`, `remote`, `url`, `apply_url`, `apply_email`, `apply_route`, `description`, `thin`, `salary jsonb`, `posted_at`, `sources jsonb`, `requirements jsonb`, `requirements_version`, `match jsonb`, `score`, `excluded_reason`, `state` (`new`/`shortlisted`/`dismissed`/`applied`), `dismiss_reason`, `attribution`. Indexed on `(user_id, score desc)` and `(user_id, found_at desc)`. |
| `career_applications` | `job_id` (unique per user), `status`, `draft jsonb` (the tailored content), `cover_note`, `answers jsonb`, `outreach`, `removed jsonb` (the truth-check removals), `ats jsonb`, `resume_pdf_path`, `resume_docx_path`, `route`, `sent_at`, `gmail_thread_id`, `company_domains text[]`, `follow_up_due`, `prediction jsonb`, `prep jsonb`, `last_event_at`, `notes`. |
| `career_events` | `application_id` (nullable for unmatched replies), `kind`, `at`, `gmail_message_id` (unique per user when present), `summary`, `details jsonb`. |
| `career_offers` | `application_id`, `compensation jsonb`, `confirmed`, `advice jsonb`. |
| `career_mail` | `(user_id, message_id)` primary key, `outcome` (`alert`/`reply`/`skipped`), `processed_at`, for once-only handling. |

- **Storage:** the private bucket `career-documents`, with `.docx` added to the upload rules for this bucket.
- **Account deletion and export:**
  - `career_profiles`, `career_jobs`, `career_applications`, `career_events` and `career_offers` are added to `EXPORT_TABLES`, with `career_profiles` in `SINGLE_ROW_TABLES`. `career_mail` is internal state, so it is left out of the export and deleted by cascade;
  - the bucket is added to `STORAGE_BUCKETS`;
  - `deletion-plan.test.ts` is updated.
- **Heads-ups:** the new kinds are `career.interview` (urgent), `career.offer` (urgent), `career.question` (urgent) and `career.follow_up` (normal), with the action `{ type: 'open_career_application'; applicationId }`. `openHeadsup` in the shell opens the Career tab on that application.

## Code layout

- `lib/career/types.ts`: the client-safe types and constants.
- `lib/career/*.ts`: pure logic, each file with a `*.test.ts` beside it:
  - `profile` (validation and merge), `spec`;
  - `normalise`, `dedupe`, `prefilter`, `requirements` (prompt and parse), `match`;
  - `tailor` (prompt and parse), `truth`, `ats`;
  - `status` (the state machine), `mail` (candidate detection, classification prompt and parse, linking), `alerts` (link spotting per sender);
  - `predict`, `insights`, `offer`, `prep`.
- `lib/career/sources/<name>.ts`: a pure `parse` plus a `fetch` wrapper. Fixtures live in `lib/career/sources/fixtures/`.
- `lib/career/render/pdf.ts`, `docx.ts`: the renderers.
- `lib/career/repository.ts`: the database (server-only). `lib/career/ingest.ts`, `watch.ts`: the cron orchestration, with time budgets.
- `lib/gmail/api.ts`: gains `getMessageFull` (body text and links), `listMessages` with a page limit, and `sendMessage` (raw MIME, thread id optional). The MIME builder is pure and tested.
- `app/career/actions.ts`: server actions, each checking `requireUser`, the rate limits on AI-heavy ones, and `aiBlocked`.
- Routes:
  - `app/api/career/ingest/route.ts` (cron, every 3 hours);
  - `app/api/career/watch/route.ts` (cron, every 15 minutes);
  - `app/api/career/file/[applicationId]/[format]/route.ts` (an owner-checked download of a tailored file);
  - `supabase/cron/career_schedule.sql`.
- Screens: `components/career/career-screen.tsx` plus one file per view and per sheet. Styles go in `app/styles/career.css`, imported from `app/(orbis)/layout.tsx`. Data is loaded by a server action when the tab mounts; nothing is added to `active/page.tsx`'s initial load.
- Env (`.env.example`, all optional, each feature stands down without its variable): `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `HIMALAYAS_API_KEY`.

## Constraints

- **Next 16.3 conventions** (read `node_modules/next/dist/docs/` first): `proxy.ts`, server actions capped at 4 MB, `maxDuration = 60` with a 50 s budget per cron run, and leftover work carried to the next run.
- **No new public-bundle mention of connected services.** `tests/e2e/public/no-leak.spec.ts` must still pass.
- **Unit tests** cover every pure module. Typecheck, lint, vitest and build all pass.
- **Signed-in e2e:** a `tests/e2e/career/` spec in the house style, mocking the app's own routes. It can't run without a live Supabase, so that is said in the handover.
- **Code style:** match the house idiom. Readonly props, no nested ternaries, no `!important`, `<output>` instead of `role="status"`, comments that explain why. The SonarCloud cleanup that just landed must not regress.

## Left to the builder

- Exact prompts, the synonym map's contents, prior coefficients (documented in code), card layouts and the visual details inside the existing design language.
- The order of work and how it is split into commits.

## Handover items for the owner

- Run the migration (`pending.sql` or the new file) and `supabase/cron/career_schedule.sql` on the live project.
- Optionally add the Adzuna and Himalayas keys.
- In Google Cloud, add `gmail.send` to the OAuth consent screen before pressing "Allow sending".
- Review the AI policy commit, which can be reverted on its own.
