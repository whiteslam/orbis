import 'server-only';

import { getMessageFull, getMessageSummary, listMessageIdsPaged, type GmailMessageSummary } from '@/lib/gmail/api';
import { gmailAccessToken, loadGmailConnection } from '@/lib/gmail/connection';
import { careerAiGate, classifyReply, draftFollowUp, prepPack, readAlertEmail } from '@/lib/career/ai';
import { alertAllowedUrls, alertGmailQuery, alertSenderFor, extractLinks, isAlertSender, spotJobLinks } from '@/lib/career/alerts';
import { dedupeKey } from '@/lib/career/dedupe';
import { fallbackFollowUp, isFollowUpDue, isGhosted } from '@/lib/career/followup';
import { isStrongCandidate, linkReply, replyCandidate, type Candidate, type OpenApp } from '@/lib/career/mail';
import { followUpHeadsup, headsupKindFor, replyHeadsup, type CareerHeadsup } from '@/lib/career/notify';
import { runPool } from '@/lib/career/pool';
import { prepLogistics } from '@/lib/career/prep';
import {
  addEvent, claimCareerRun, createOffer, getCareerRow, listApplications, listCareerUsers, listJobsByIds, markMailSeen,
  pruneCareerMail, reclassifyEvent, releaseCareerRun, seenMessageIds, setLastMailScan, transitionApplication, updateApplication,
  upsertJobs, type CareerDb, type CareerRow, type MailOutcome,
} from '@/lib/career/repository';
import { careerToday, scoreJob } from '@/lib/career/scoring';
import { isWatched, isWatchedNow, statusFromReply } from '@/lib/career/status';
import { htmlToText } from '@/lib/career/text';
import { APPLICATION_STATUSES } from '@/lib/career/types';
import type { CareerApplication, CareerEvent, CareerJob, CareerProfile, CareerSpec, NormalizedJob, OfferTerms, ReplyClassification } from '@/lib/career/types';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  eventKindFor, ghostedSummary, logisticsOnlyPrep, openAppsFrom, replyDetails, replyGmailQuery, retryClassification,
} from '@/lib/career/watch-plan';

// The Gmail watcher, every 15 minutes: job-alert emails become thin jobs,
// replies move applications along and raise heads-ups, and the clock drafts
// follow-ups and marks the silent ones ghosted. Every Gmail message is
// handled once (career_mail), and nothing is ever sent from here.

export type WatchSummary = { alerts: number; jobs: number; replies: number; unmatched: number; followUps: number; ghosted: number };
export type WatchRunSummary = WatchSummary & { users: number; failed: number };

const EMPTY: WatchSummary = { alerts: 0, jobs: 0, replies: 0, unmatched: 0, followUps: 0, ghosted: 0 };

const ALERT_IDS = 25;
const ALERTS_PER_RUN = 6;
const ALERT_AI_MS = 20_000;
/** The design's cap: at most 25 messages looked at per run, newest first. */
const READS_PER_RUN = 25;
const REPLY_IDS = 60;
const MAIL_AI_MS = 12_000;
const PREP_AI_MS = 25_000;
const FOLLOW_UP_AI_MS = 12_000;
const LANES = 3;
/** The cron runs every 15 minutes; a claim younger than this is another run's. */
const CLAIM_STALE_MS = 10 * 60_000;
const INDIA = 'Asia/Kolkata';
const EMPTY_TERMS: OfferTerms = { fixed: null, variable: null, joiningBonus: null, equity: null, currency: null, period: null, startDate: null, deadline: null };

type Person = {
  userId: string;
  profile: CareerProfile;
  spec: CareerSpec;
  settings: CareerRow['settings'];
  timeZone: string;
  today: string;
  disabled: ReadonlySet<string>;
  /** Messages handled this run, marked once at the end. */
  marks: Array<{ id: string; outcome: MailOutcome }>;
  counts: WatchSummary;
};

const timeLeft = (deadline: number) => deadline - Date.now();

// ─── Heads-ups ─────────────────────────────────────────────────────────────

async function personPrefs(admin: CareerDb, userId: string) {
  const [prefs, notify] = await Promise.all([
    admin.from('headsup_preferences').select('disabled_kinds').eq('user_id', userId).maybeSingle(),
    admin.from('notification_preferences').select('timezone').eq('user_id', userId).maybeSingle(),
  ]);
  const disabled = Array.isArray(prefs.data?.disabled_kinds) ? (prefs.data.disabled_kinds as string[]) : [];
  const timeZone = typeof notify.data?.timezone === 'string' && notify.data.timezone ? notify.data.timezone : INDIA;
  return { disabled: new Set(disabled), timeZone };
}

/**
 * Saves a heads-up the way the daily scan does, worded by rules. The dedupe
 * key makes a re-run a no-op. Urgent ones are pushed by the heads-up cron's
 * pushWaiting (app/api/headsups/scan), within the owner's push caps and quiet hours.
 */
async function raiseHeadsup(admin: CareerDb, person: Person, headsup: CareerHeadsup) {
  if (person.disabled.has(headsup.kind)) return;
  const { error } = await admin.from('headsups').upsert({
    user_id: person.userId, kind: headsup.kind, dedupe_key: headsup.dedupeKey, urgency: headsup.urgency, evidence: headsup.evidence,
    title: headsup.title, body: headsup.body, action: headsup.action, action_label: headsup.actionLabel, worded_by: 'rules', status: 'new',
  }, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
  if (error) console.error('Saving a career heads-up failed', error);
}

// ─── Job alerts ────────────────────────────────────────────────────────────

type AlertRead = { id: string; jobs: NormalizedJob[]; done: boolean };

async function readOneAlert(person: Person, token: string, id: string, deadline: number): Promise<AlertRead> {
  const message = await getMessageFull(token, id);
  if (!message) return { id, jobs: [], done: true };
  // Anyone can send a "Job alert": an unknown sender's jobs are credited as a
  // generic "Job alert", and like every alert sighting (low trust) they never
  // say which company a mail domain belongs to (lib/career/recipient.ts).
  const label = alertSenderFor(message.from)?.label ?? 'Job';
  const links = extractLinks(message.html);
  const spotted = spotJobLinks(label, links);
  if (!links.length) return { id, jobs: [], done: true };
  const bodyText = message.text || htmlToText(message.html);
  const input = { senderLabel: label, subject: message.subject, spotted, bodyText, links };
  const jobs = await readAlertEmail(person.userId, input, alertAllowedUrls(spotted, links), { timeoutMs: Math.min(ALERT_AI_MS, timeLeft(deadline) - 2_000) });
  // No answer: left unmarked, so the next run tries again while the email is still in the window.
  return { id, jobs: jobs ?? [], done: jobs !== null };
}

/** Thin jobs score on the prefilter and role fit alone, without AI. */
async function scoreNew(admin: CareerDb, person: Person, ids: string[], deadline: number) {
  if (!ids.length) return;
  const jobs = await listJobsByIds(person.userId, ids, admin);
  const score = (job: CareerJob) => scoreJob(admin, person.userId, job, person.profile, person.spec, person.settings, { today: person.today });
  await runPool(jobs, score, { limit: 4, deadline, taskMs: 1_500 });
}

async function readAlerts(admin: CareerDb, person: Person, token: string, deadline: number) {
  if (!person.settings.sources.gmail_alerts || (await careerAiGate(person.userId))) return;
  const ids = await listMessageIdsPaged(token, alertGmailQuery(), ALERT_IDS);
  const seen = await seenMessageIds(admin, person.userId, ids);
  const fresh = ids.filter((id) => !seen.has(id)).slice(0, ALERTS_PER_RUN);
  const { results } = await runPool(fresh, (id) => readOneAlert(person, token, id, deadline), { limit: LANES, deadline, taskMs: ALERT_AI_MS + 5_000 });
  const found = results.flatMap((read) => read.jobs.map((job) => ({ ...job, dedupeKey: dedupeKey(job) })));
  const newIds = await upsertJobs(admin, person.userId, found);
  await scoreNew(admin, person, newIds, deadline);
  for (const read of results) if (read.done) person.marks.push({ id: read.id, outcome: 'alert' });
  person.counts.alerts += results.filter((read) => read.done).length;
  person.counts.jobs += newIds.length;
}

// ─── Replies ───────────────────────────────────────────────────────────────

type Watched = { apps: Map<string, CareerApplication>; jobs: Map<string, CareerJob>; open: OpenApp[]; sentThreads: Set<string> };

// Rejected ones are read too, and kept for 30 days (isWatchedNow).
const WATCH_STATUSES = APPLICATION_STATUSES.filter((status) => isWatched(status) || status === 'rejected');

async function watchedApplications(admin: CareerDb, userId: string, now: Date): Promise<Watched> {
  const apps = (await listApplications(userId, { statuses: WATCH_STATUSES }, admin)).filter((app) => isWatchedNow(app, now));
  const jobs = new Map((await listJobsByIds(userId, apps.map((app) => app.jobId), admin)).map((job) => [job.id, job]));
  return {
    apps: new Map(apps.map((app) => [app.id, app])),
    jobs,
    open: openAppsFrom(apps, jobs),
    sentThreads: new Set(apps.flatMap((app) => (app.gmailThreadId ? [app.gmailThreadId] : []))),
  };
}

type Classified = { summary: GmailMessageSummary; candidate: Candidate; classification: ReplyClassification | null };

async function classifyOne(person: Person, token: string, item: { summary: GmailMessageSummary; candidate: Candidate }, deadline: number): Promise<Classified> {
  const full = await getMessageFull(token, item.summary.id);
  const body = full ? full.text || htmlToText(full.html) : item.summary.snippet;
  const timeoutMs = Math.min(MAIL_AI_MS, timeLeft(deadline) - 2_000);
  const classification = await classifyReply(person.userId, { from: item.summary.from, subject: item.summary.subject, body }, { timeoutMs });
  return { ...item, classification };
}

/** Moves the application forward as the reply says, if the rules allow it. */
async function moveStatus(admin: CareerDb, person: Person, app: CareerApplication, classification: ReplyClassification) {
  const target = statusFromReply(app.status, classification.kind);
  if (!target) return;
  const moved = await transitionApplication(admin, person.userId, app.id, [app.status], target);
  if (moved) app.status = target;
}

/** The interview's prep pack; its logistics alone when there's no time or no model. */
async function storePrep(admin: CareerDb, person: Person, app: CareerApplication, job: CareerJob, classification: ReplyClassification, deadline: number) {
  const logistics = prepLogistics(classification, person.timeZone);
  const timeoutMs = Math.min(PREP_AI_MS, timeLeft(deadline) - 3_000);
  const pack = timeoutMs >= 8_000
    ? await prepPack(person.userId, { job, requirements: job.requirements, match: job.match, profile: person.profile, classification, logistics }, { timeoutMs })
    : null;
  const prep = pack ?? logisticsOnlyPrep(logistics);
  await updateApplication(person.userId, app.id, { prep }, admin);
  return prep;
}

/**
 * What a reply tied to an application by its thread or company domain sets
 * off: status, offer row, prep pack, heads-up. The offer row and prep pack
 * follow the status, so mail that can't move the card (a reply to a rejected
 * application) only lands on the timeline and raises its heads-up.
 */
async function actOnReply(admin: CareerDb, person: Person, watched: Watched, item: Classified & { applicationId: string; classification: ReplyClassification }, deadline: number) {
  const app = watched.apps.get(item.applicationId);
  const job = app ? watched.jobs.get(app.jobId) : undefined;
  if (!app || !job) return;
  const { classification } = item;
  await moveStatus(admin, person, app, classification);
  // Unconfirmed until the owner checks the terms; advice waits for that.
  if (classification.kind === 'offer' && app.status === 'offer') {
    await createOffer(person.userId, { applicationId: app.id, terms: classification.offer ?? EMPTY_TERMS }, admin);
  }
  const invited = classification.kind === 'interview_invite' && app.status === 'interview';
  const prep = invited ? await storePrep(admin, person, app, job, classification, deadline) : null;
  const kind = headsupKindFor(classification.kind);
  if (!kind) return;
  await raiseHeadsup(admin, person, replyHeadsup({
    kind, applicationId: app.id, messageId: item.summary.id, company: job.company, role: job.title, summary: classification.summary, at: prep?.logistics.at ?? null,
  }));
}

/**
 * Records one reply tied by thread or domain on the timeline (unmatched when
 * no single application fits) and acts on it.
 */
async function recordReply(admin: CareerDb, person: Person, watched: Watched, item: Classified, deadline: number) {
  const { summary, candidate, classification } = item;
  const applicationId = (classification ? linkReply(classification, summary, watched.open) : null) ?? candidate.applicationId;
  const event = await addEvent(person.userId, {
    applicationId,
    kind: eventKindFor(classification?.kind ?? 'other'),
    summary: classification?.summary ?? (summary.subject || 'A reply about an application'),
    at: summary.receivedAt,
    details: replyDetails({
      from: summary.from, subject: summary.subject, classification, reason: candidate.reason, threadId: summary.threadId,
      snippet: classification ? undefined : summary.snippet,
    }),
    gmailMessageId: summary.id,
  }, admin);
  person.marks.push({ id: summary.id, outcome: 'reply' });
  // Already recorded by an earlier run: its effects happened then.
  if (!event) return;
  if (applicationId) person.counts.replies += 1;
  else person.counts.unmatched += 1;
  if (applicationId && classification) await actOnReply(admin, person, watched, { ...item, applicationId, classification }, deadline);
}

/**
 * A message tied to an application only by a company name in its subject or
 * preview: recorded unmatched, unread and unclassified (no model credit, no
 * effects), with Gmail's preview and the application the name suggests. The
 * owner attaches it, and it is classified then (attachReplyAction).
 */
async function recordUnmatched(admin: CareerDb, person: Person, item: { summary: GmailMessageSummary; candidate: Candidate }) {
  const { summary, candidate } = item;
  const event = await addEvent(person.userId, {
    applicationId: null,
    kind: 'reply',
    summary: summary.subject || 'A reply about an application',
    at: summary.receivedAt,
    details: replyDetails({
      from: summary.from, subject: summary.subject, classification: null, reason: candidate.reason,
      threadId: summary.threadId, snippet: summary.snippet, suggestedApplicationId: candidate.applicationId,
    }),
    gmailMessageId: summary.id,
  }, admin);
  person.marks.push({ id: summary.id, outcome: 'reply' });
  if (event) person.counts.unmatched += 1;
}

/** Which unseen messages are worth reading: everything else is marked skipped from its headers alone. */
async function replyCandidates(admin: CareerDb, person: Person, token: string, watched: Watched, deadline: number) {
  const ids = await listMessageIdsPaged(token, replyGmailQuery(), REPLY_IDS);
  const seen = await seenMessageIds(admin, person.userId, ids);
  const fresh = ids.filter((id) => !seen.has(id)).slice(0, READS_PER_RUN);
  if (!watched.open.length) {
    for (const id of fresh) person.marks.push({ id, outcome: 'skipped' });
    return [];
  }
  const { results } = await runPool(fresh, (id) => getMessageSummary(token, id), { limit: 5, deadline, taskMs: 3_000 });
  const candidates: Array<{ summary: GmailMessageSummary; candidate: Candidate }> = [];
  for (const summary of results) {
    // An alert that slipped into this search is the alert pass's to handle.
    if (!summary || isAlertSender(summary.from)) continue;
    const candidate = replyCandidate(summary, watched.open, watched.sentThreads);
    if (candidate) candidates.push({ summary, candidate });
    else person.marks.push({ id: summary.id, outcome: 'skipped' });
  }
  return candidates;
}

async function readReplies(admin: CareerDb, person: Person, token: string, deadline: number) {
  const now = new Date();
  const watched = await watchedApplications(admin, person.userId, now);
  const candidates = await replyCandidates(admin, person, token, watched, deadline);
  const strong = candidates.filter((item) => isStrongCandidate(item.candidate));
  for (const item of candidates) {
    if (!isStrongCandidate(item.candidate)) await recordUnmatched(admin, person, item); // NOSONAR: a handful a run, one insert each
  }
  // With AI off, the strong ones stay unread and unmarked until it is back (within the 3-day window).
  if (!strong.length || (await careerAiGate(person.userId))) return;
  const { results } = await runPool(strong, (item) => classifyOne(person, token, item, deadline), { limit: LANES, deadline, taskMs: MAIL_AI_MS + 5_000 });
  const inOrder = results.toSorted((a, b) => a.summary.receivedAt.localeCompare(b.summary.receivedAt));
  for (const item of inOrder) {
    // No model answered (credits spent, none available): left unmarked for a later run, until it nears the end of the search window.
    if (!item.classification && retryClassification(item.summary.receivedAt, now)) continue;
    // Oldest first, one at a time: an acknowledgement then an invite must move the card in that order.
    await recordReply(admin, person, watched, item, deadline); // NOSONAR: replies to one application must apply in the order they arrived
  }
}

/**
 * A reply recorded unread (tied to an application only by a company name) is
 * read and classified when the owner attaches it, so its effects can follow.
 * Null when it can't be read now (no Gmail, AI off, no answer): it stays a
 * plain reply on the timeline.
 */
export async function classifyAttached(userId: string, event: CareerEvent): Promise<ReplyClassification | null> {
  if (event.details.classified !== false || !event.gmailMessageId) return null;
  if (await careerAiGate(userId)) return null;
  const token = await mailToken(userId);
  if (!token) return null;
  const full = await getMessageFull(token, event.gmailMessageId).catch((error: unknown) => {
    console.error('Reading an attached reply failed', error);
    return null;
  });
  if (!full) return null;
  const classification = await classifyReply(userId, { from: full.from, subject: full.subject, body: full.text || htmlToText(full.html) }, { timeoutMs: MAIL_AI_MS });
  if (!classification) return null;
  const reason = typeof event.details.matchedBy === 'string' ? event.details.matchedBy : 'words';
  const details = replyDetails({ from: full.from, subject: full.subject, classification, reason, threadId: full.threadId });
  await reclassifyEvent(createAdminClient(), userId, event.id, { kind: eventKindFor(classification.kind), summary: classification.summary, details: { ...details, attachedBy: 'owner' } });
  return classification;
}

// ─── Follow-ups and ghosting ───────────────────────────────────────────────

async function ghost(admin: CareerDb, person: Person, app: CareerApplication) {
  const moved = await transitionApplication(admin, person.userId, app.id, [app.status], 'ghosted', { followUpDue: null });
  if (!moved) return;
  person.counts.ghosted += 1;
  await addEvent(person.userId, { applicationId: app.id, kind: 'status_change', summary: ghostedSummary(person.settings.ghostDays), details: { from: app.status, to: 'ghosted', by: 'system' } }, admin);
}

async function draftOneFollowUp(admin: CareerDb, person: Person, app: CareerApplication & { sentAt: string }, job: CareerJob, deadline: number) {
  const input = { name: person.profile.contact.name, job: { title: job.title, company: job.company }, sentAt: app.sentAt, coverNote: app.coverNote?.text ?? null };
  const timeoutMs = Math.min(FOLLOW_UP_AI_MS, timeLeft(deadline) - 2_000);
  const written = timeoutMs >= 5_000 && !(await careerAiGate(person.userId)) ? await draftFollowUp(person.userId, input, { timeoutMs }) : null;
  // Handled: the draft waits for Send, and the due date is cleared so it's drafted once.
  await updateApplication(person.userId, app.id, { followUpDraft: written ?? fallbackFollowUp(input), followUpDue: null }, admin);
  person.counts.followUps += 1;
  await raiseHeadsup(admin, person, followUpHeadsup({ applicationId: app.id, company: job.company, role: job.title, day: person.today }));
}

async function followUpsAndGhosts(admin: CareerDb, person: Person, deadline: number) {
  const apps = await listApplications(person.userId, { statuses: ['sent', 'acknowledged'] }, admin);
  const ghosts = apps.filter((app) => isGhosted(app, person.today, person.settings.ghostDays));
  await Promise.all(ghosts.map((app) => ghost(admin, person, app)));
  const due = apps.filter((app): app is CareerApplication & { sentAt: string } =>
    !ghosts.includes(app) && app.sentAt !== null && !app.followUpDraft && isFollowUpDue(app, person.today));
  if (!due.length) return;
  const jobs = new Map((await listJobsByIds(person.userId, due.map((app) => app.jobId), admin)).map((job) => [job.id, job]));
  const ready = due.flatMap((app) => {
    const job = jobs.get(app.jobId);
    return job ? [{ app, job }] : [];
  });
  await runPool(ready, ({ app, job }) => draftOneFollowUp(admin, person, app, job, deadline), { limit: LANES, deadline, taskMs: FOLLOW_UP_AI_MS + 3_000 });
}

// ─── One person, everyone ──────────────────────────────────────────────────

/** A token for a working Google connection, or null (none, or it needs reconnecting). */
async function mailToken(userId: string): Promise<string | null> {
  try {
    const connection = await loadGmailConnection(userId);
    if (connection?.status !== 'connected') return null;
    return await gmailAccessToken(userId, connection);
  } catch (error) {
    console.error('Career watcher could not reach Gmail', error);
    return null;
  }
}

async function readMail(admin: CareerDb, person: Person, deadline: number) {
  const token = await mailToken(person.userId);
  if (!token) return;
  try {
    await readAlerts(admin, person, token, deadline);
    await readReplies(admin, person, token, deadline);
  } catch (error) {
    // Gmail failing mid-run must not stop follow-ups and ghosting, which need no mail.
    console.error('Career watcher could not read mail', error);
  }
}

/**
 * One person's watch: alerts and replies (with a working Google connection),
 * then follow-ups and ghosting (always). Every message looked at is marked
 * handled, even if a later step fails.
 */
export async function watchUser(admin: CareerDb, userId: string, options: { deadline: number }): Promise<WatchSummary> {
  const row = await getCareerRow(userId, admin);
  if (!row?.profile || !row.spec) return { ...EMPTY };
  const { disabled, timeZone } = await personPrefs(admin, userId);
  const person: Person = {
    userId, profile: row.profile, spec: row.spec, settings: row.settings, timeZone, today: careerToday(new Date(), timeZone), disabled, marks: [], counts: { ...EMPTY },
  };
  try {
    await readMail(admin, person, options.deadline);
    await followUpsAndGhosts(admin, person, options.deadline);
  } finally {
    await markMailSeen(admin, userId, person.marks);
  }
  await setLastMailScan(admin, userId);
  return person.counts;
}

function add(total: WatchRunSummary, part: WatchSummary) {
  for (const key of Object.keys(part) as Array<keyof WatchSummary>) total[key] += part[key];
}

/** Everyone due, longest-waiting first, until the deadline. The rest are picked up by the next run. */
export async function watchDue(admin: CareerDb, now: Date, deadline: number): Promise<WatchRunSummary> {
  const summary: WatchRunSummary = { ...EMPTY, users: 0, failed: 0 };
  await pruneCareerMail(admin);
  const staleBefore = new Date(now.getTime() - CLAIM_STALE_MS).toISOString();
  for (const person of await listCareerUsers(admin, 'mail')) {
    if (timeLeft(deadline) < 10_000) break;
    if (!(await claimCareerRun(admin, person.userId, 'mail', now.toISOString(), staleBefore))) continue; // NOSONAR: one person at a time, so the run stops cleanly at the deadline
    try {
      add(summary, await watchUser(admin, person.userId, { deadline })); // NOSONAR: as above
      summary.users += 1;
    } catch (error) {
      console.error('Career watch failed for a person', error);
      summary.failed += 1;
      await releaseCareerRun(admin, person.userId, 'mail', person.lastMailScanAt).catch(() => undefined); // NOSONAR: as above
    }
  }
  return summary;
}
