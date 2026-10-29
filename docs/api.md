# Orbis API (v1)

The API lets a script or another app use Orbis as you: read the same summaries
the app shows and run the same actions the app runs. Everything checks you the
same way the app does, and the database still only ever shows a token its own
user's rows.

It is **off by default**. Set `ORBIS_API_ENABLED=true` on the server to turn it
on; until then every `/api/v1` route answers 404.

## Signing in

```sh
curl -X POST https://<your-orbis>/api/v1/auth/token \
  -H 'content-type: application/json' \
  -d '{"email": "you@example.com", "password": "..."}'
```

```json
{ "tokenType": "bearer", "accessToken": "eyJ...", "refreshToken": "abc...", "expiresAt": 1793270000 }
```

Send the access token with every other call:

```sh
curl https://<your-orbis>/api/v1/data/finance -H 'authorization: Bearer eyJ...'
```

The access token lasts about an hour (`expiresAt` is in Unix seconds). Before
then, swap the refresh token for a new pair. Each refresh token works once, so
always keep the newest one:

```sh
curl -X POST https://<your-orbis>/api/v1/auth/refresh \
  -H 'content-type: application/json' -d '{"refreshToken": "abc..."}'
```

These are real Orbis sessions, the same as signing in to the app, and the same
allowlist applies (`ORBIS_ALLOWED_EMAILS`). Signing out in the app signs out
every session, these included: their refresh tokens stop working at once, but
an access token already handed out keeps working until it expires, up to an
hour later. The sign-in and refresh routes allow 10 tries per address every
15 minutes.

The PIN and app lock protect a device that has been left open, so they don't
apply here: the token is the proof. Keep it as safe as your password.

## Reading

`GET /api/v1/data/<area>` returns `{"data": ...}`, the same summary the app loads
for that area:

| Area | What it is |
|---|---|
| `finance` | This month's spending, recent transactions, your income plan and the investments you recorded |
| `notes` | What you've told Orbis to remember |
| `fitness` | Your fitness persona |
| `profile` | Your personal profile |
| `home-location` | Your home city |
| `steps` | Daily steps |
| `journal` | Journal entries |
| `notifications` | Notification settings |
| `health-library` | Health documents and plans |
| `workbook-advice` | The last saved workbook advice |
| `portfolio-advice` | The last saved portfolio advice |
| `ai-preferences` | AI on/off and the Home brief setting |
| `routines` | Routines and today's answers |
| `social-connections` | Which social accounts are connected |
| `integrations` | Which services are connected |
| `app-connections` | Gmail, brokers and other connections |

## Actions

`POST /api/v1/actions/<name>` runs one of the app's own actions. Its arguments
go in `args`, in order:

```sh
curl -X POST https://<your-orbis>/api/v1/actions/social.loadMonth \
  -H 'authorization: Bearer eyJ...' -H 'content-type: application/json' \
  -d '{"args": ["2026-10-01"]}'
```

The reply is `{"result": ...}`: whatever the action returned in the app. When
the action refuses (`{"success": false, "message": ...}` or `{"error": ...}`)
the status is **422** and the message says why, in the app's own words.

Actions that use AI spend the same daily allowance they do in the app.
`GET /api/v1` lists every action and area, and needs no token.

### What is left out

These stay in the app on purpose, so a leaked token can't do them:

- signing in or out, passwords, the PIN and app lock, deleting the account, the waitlist
- anything that sends a message as you: career applications, follow-ups and offer replies
- connecting or disconnecting Gmail, brokers, Instagram or Threads, and push subscriptions
- voice uploads and Talk to Orbis, which take form data rather than JSON

### Every action

| Action | Arguments |
|---|---|
| `ai.deleteSavedResult` | `id: unknown` |
| `ask.ask` | `input: { question: string; sources: string[]; earlier?: unknown; about?: unknown }` |
| `career.load` | — |
| `career.loadSetup` | — |
| `career.listJobs` | `filters: JobFilters` |
| `career.jobDetail` | `jobId: string` |
| `career.createResumeUpload` | `file: { name: string; type: string; size: number }` |
| `career.processResume` | `path: string, fileName: string` |
| `career.saveProfile` | `profile: CareerProfile` |
| `career.saveSpec` | `spec: CareerSpec` |
| `career.specFromSentence` | `sentence: string` |
| `career.saveSettings` | `patch: Partial<CareerSettings>` |
| `career.pasteJob` | `input: { url?: string; text?: string; title?: string; company?: string }` |
| `career.setJobState` | `jobId: string, state: JobState, reason?: string` |
| `career.rescoreJob` | `jobId: string, description?: string` |
| `career.draftApplication` | `jobId: string` |
| `career.updateDraft` | `applicationId: string, patch: DraftPatch` |
| `career.markApplied` | `applicationId: string` |
| `career.ownerMoves` | `applicationId: string` |
| `career.moveApplication` | `applicationId: string, to: ApplicationStatus` |
| `career.attachReply` | `eventId: string, applicationId: string` |
| `career.saveOfferTerms` | `applicationId: string, terms: OfferTerms` |
| `career.adviseOffer` | `offerId: string` |
| `career.runSearchNow` | — |
| `career.insights` | — |
| `career.exportTracker` | — |
| `finance.addManualTransaction` | `input: ManualTransactionInput` |
| `finance.deleteManualTransaction` | `transactionId: string` |
| `finance.saveIncomePlan` | `input: { id?: string; label: string; amount: string; currency: string; payDay: number; category: string }` |
| `finance.deleteIncomePlan` | `id: string` |
| `headsups.snooze` | `id: unknown` |
| `headsups.dismiss` | `id: unknown` |
| `headsups.complete` | `id: unknown` |
| `headsups.setKind` | `kind: unknown, enabled: unknown` |
| `headsups.clear` | — |
| `health.signWorkbookUpload` | `file: { name: string; type: string; size: number }` |
| `health.parseWorkbook` | `input: { path: string; name: string }` |
| `health.generateWorkbookAdvice` | `value: unknown` |
| `health.setDocumentAlways` | `input: unknown` |
| `health.signDocumentUpload` | `file: { name: string; type: string; size: number }` |
| `health.uploadDocument` | `input: { path: string; name: string }` |
| `health.deleteDocument` | `id: string` |
| `health.downloadDocument` | `id: string` |
| `health.startPlan` | — |
| `health.generatePlan` | `input: { answers: PlanAnswer[] }` |
| `health.deletePlan` | `id: string` |
| `health.importAppleHealthSteps` | `input: unknown` |
| `health.deleteSteps` | — |
| `home.setBriefEnabled` | `enabled: unknown` |
| `home.setAiEnabled` | `enabled: unknown` |
| `home.aiUsage` | — |
| `home.acknowledgeMail` | `messageId: unknown` |
| `invest.loadLive` | — |
| `invest.generatePortfolioAdvice` | `value: unknown` |
| `personal.addNote` | `noteInput: string` |
| `personal.updateNote` | `id: string, noteInput: string` |
| `personal.deleteNote` | `id: string` |
| `personal.noteHistory` | `id: string` |
| `personal.deletedNotes` | — |
| `personal.saveFitnessPersona` | `personaInput: string` |
| `personal.deleteFitnessPersona` | — |
| `personal.saveProfile` | `value: unknown` |
| `personal.deleteProfile` | — |
| `personal.saveHomeCity` | `cityInput: string` |
| `personal.clearHomeCity` | — |
| `journal.saveEntry` | `input: { date: string; mood: number; body: string; tags: string[] }` |
| `journal.deleteEntry` | `date: string` |
| `journal.history` | `date: string` |
| `journal.deleted` | — |
| `journal.voiceNoteUrl` | `id: string` |
| `journal.deleteVoiceNote` | `id: string` |
| `notifications.savePreferences` | `input: NotificationPreferences` |
| `notifications.sendTest` | — |
| `research.load` | — |
| `research.start` | `input: unknown` |
| `research.loadRun` | `runId: unknown, afterSeq: unknown = 0` |
| `research.cancelRun` | `runId: unknown` |
| `research.saveSettings` | `patch: unknown` |
| `routines.save` | `input: { id?: string; title: string; kind: string; atTime: string; days: number[]; flexible?: unknown }` |
| `routines.archive` | `id: string, archived: boolean` |
| `routines.delete` | `id: string` |
| `routines.answer` | `input: { routineId: string; title: string; status: string \| null; note?: string }` |
| `social.loadMonth` | `period: string` |
| `social.savePost` | `input: { id?: string; clientId?: string; period: string; title: string; headline?: string \| null; caption: string; hashtags: string[]; format: string; platforms: string[]; plannedFor: string \| null; }` |
| `social.setPostStatus` | `id: string, status: 'idea' \| 'draft' \| 'ready'` |
| `social.markPublished` | `id: string, publish: { platform: string; link?: string \| null } \| null` |
| `social.duplicatePost` | `id: string` |
| `social.movePost` | `id: string, period: string` |
| `social.deletePost` | `id: string` |
| `social.signMediaUpload` | `postId: string, file: { name: string; type: string; size: number }` |
| `social.attachMedia` | `postId: string, path: string, type: 'image' \| 'video'` |
| `social.removeMedia` | `postId: string` |
| `social.draftWithAi` | `input: DraftMonthInput` |
| `social.postHistory` | `id: string` |
| `social.insights` | — |

Types such as `JobFilters` or `DraftMonthInput` are defined in the app's source,
next to the action (`app/<area>/actions.ts`) or in `lib/<area>/types.ts`.

## Errors

| Status | Meaning |
|---|---|
| 400 | The body isn't JSON, or `args` isn't an array of at most 4 values |
| 401 | No token, or it's invalid or expired: refresh it, or sign in again |
| 403 | This account isn't allowed to use this Orbis |
| 404 | No such action or area, or the API is switched off |
| 413 | The body is over 256 KB |
| 422 | The action refused; see `result.message` |
| 429 | Too many sign-ins or refreshes from this address |
| 500 | Something failed on the server |

Every error body is `{"error": "<what went wrong>"}`. Responses are never cached.
