import 'server-only';

import { applyEmailFor } from '@/lib/career/draft-plan';
import { predictionFor } from '@/lib/career/drafting';
import { applyRecipient, lastSentMessage, offerReplyTarget, trustedCompanyDomains, type ReplyTarget } from '@/lib/career/recipient';
import {
  addEvent, CareerError, claimSendLock, countSentSince, downloadCareerFile, getApplication, getApplicationFiles, getCareerRow, getJob, getOffer,
  listEvents, releaseSendLock, sentAddresses, setJobState, transitionApplication, updateApplication, type CareerDb, type CareerRow,
} from '@/lib/career/repository';
import { careerToday } from '@/lib/career/scoring';
import {
  addDays, applicationBody, applicationSubject, composeUrl, oneLine, recruiteeEndpoint, replyReferences, replySubject, resumeFileName,
} from '@/lib/career/send-plan';
import { USER_AGENT } from '@/lib/career/sources/http';
import type { ApplicationStatus, ApplyRoute, CareerApplication, CareerEvent, CareerJob, CareerProfile } from '@/lib/career/types';
import { findSentByRef, getMessageFull, GmailSendScopeError, GmailSendUncertainError, sendMessage, type GmailMessageFull } from '@/lib/gmail/api';
import { gmailAccessToken, type GmailConnection } from '@/lib/gmail/connection';
import { senderAddress } from '@/lib/gmail/important-filter';
import { buildRawMessage, formatAddress } from '@/lib/gmail/mime';
import { GMAIL_SEND_SCOPE, GoogleOAuthError } from '@/lib/gmail/oauth';
import { createAdminClient } from '@/lib/supabase/admin';

// Sending: an application, a follow-up, a reply to an offer. Every function
// here runs only from the owner's own press (app/career/actions.ts), never from
// a cron, and each one sends at most once per press:
// - an application moves ready → sending in one conditional update, so a
//   double press finds it already moving and stops;
// - nothing is left in `sending`: any failure puts it back to ready with a
//   note, and a `sending` older than five minutes counts as ready again;
// - once Gmail or Recruitee has accepted it, nothing afterwards can undo that,
//   so a later bookkeeping failure is logged, never turned back into "ready";
// - when Gmail's answer is lost, the Sent folder decides whether it went
//   (each message carries an X-Orbis-Ref to find it by), and when Recruitee's
//   is lost, the owner is told it may have gone rather than offered a resend;
// - a follow-up or offer reply holds a send lock (claimSendLock) while it goes,
//   so a second press can't send it twice;
// - the email route sends only to the address the Send bar showed, and asks
//   for a confirmation the first time an address (or company domain) is used.

export type SendResult =
  | { kind: 'sent' }
  | { kind: 'opened'; url: string; message?: string }
  | { kind: 'compose'; url: string }
  | { kind: 'refused'; message: string };

export type ReplyResult = { ok: true } | { ok: false; message: string };

/** What the owner saw and agreed to on the Send bar. */
export type SendConfirmation = { to?: string | null; confirmed?: boolean };

/** A reason not to send, written for the owner. */
class SendRefusal extends Error {}

export const SEND_PERMISSION_MESSAGE = 'Allow sending in Career → Setup first.';
const NOTHING_WENT = 'That couldn’t be sent, and nothing went out. Try again in a little while.';
/** A `sending` this old was left behind by a request that died; the next Send may take it over. */
export const STALE_SENDING_MS = 5 * 60_000;
/** A second press within this long of a reply that went is a double press, not a second reply. */
const REPEAT_WINDOW_MS = 2 * 60_000;
const RECRUITEE_TIMEOUT_MS = 20_000;
/** A send lock this old was left by a request that died. Gmail's own timeout is 30 s. */
const LOCK_STALE_MS = 2 * 60_000;
const NOT_IN_SENT = 'Gmail didn’t answer in time, and the email isn’t in your Sent folder, so it looks like nothing went out. Check Sent in Gmail before you send again.';
const UNSURE_SENT = 'Gmail didn’t answer in time and Orbis couldn’t check your Sent folder. Check Sent in Gmail before you send again.';
const PDF_TYPE = 'application/pdf';
const IST_OFFSET = '+05:30';

const DONE: readonly ApplicationStatus[] = [
  'sent', 'acknowledged', 'replied', 'assessment', 'interview', 'offer', 'accepted', 'declined', 'rejected', 'withdrawn', 'ghosted',
];
const FOLLOW_UP_FROM: readonly ApplicationStatus[] = ['sent', 'acknowledged', 'ghosted'];

function messageOf(error: unknown): string {
  if (error instanceof SendRefusal || error instanceof CareerError || error instanceof GmailSendScopeError || error instanceof GoogleOAuthError) {
    return error.message;
  }
  console.error('Career send failed', error);
  return NOTHING_WENT;
}

/** When the owner's day began, for the daily cap. Career counts days in India time, as careerToday does. */
function dayStartIso(day: string) {
  return new Date(`${day}T00:00:00${IST_OFFSET}`).toISOString();
}

const applyPage = (job: Pick<CareerJob, 'applyUrl' | 'url'>) => job.applyUrl ?? job.url;

function validAddress(address: string): boolean {
  try {
    formatAddress(address);
    return true;
  } catch {
    return false;
  }
}

/** "Asha Rao <asha@gmail.com>", from the connected Gmail address. */
function fromHeader(name: string, email: string) {
  const clean = oneLine(name, 80).replaceAll(/[<>"]/g, '');
  return clean ? `${clean} <${email}>` : email;
}

// ─── Gmail ────────────────────────────────────────────────────────────────

type SendableConnection = GmailConnection & { canSend: boolean };

/** The Google connection and whether it may send. Read with the service role: the table holds tokens. */
async function gmailConnection(userId: string): Promise<SendableConnection | null> {
  const { data, error } = await createAdminClient().from('gmail_connections')
    .select('id, user_id, google_email, refresh_token_encrypted, status, granted_scopes').eq('user_id', userId).maybeSingle();
  if (error) {
    console.error('Reading the Gmail connection for sending failed', error);
    return null;
  }
  if (!data) return null;
  const scopes = Array.isArray(data.granted_scopes) ? data.granted_scopes : [];
  const connection = data as GmailConnection;
  return { ...connection, canSend: connection.status === 'connected' && scopes.includes(GMAIL_SEND_SCOPE) };
}

/** A token that may send, or a refusal saying to allow sending first. */
async function sendingToken(userId: string): Promise<{ token: string; email: string }> {
  const connection = await gmailConnection(userId);
  if (!connection?.canSend) throw new SendRefusal(SEND_PERMISSION_MESSAGE);
  return { token: await gmailAccessToken(userId, connection), email: connection.google_email };
}

/** A reference for one message, carried as X-Orbis-Ref so it can be found in Sent. */
function messageRef(kind: string, id: string, now: Date) {
  return `${kind}-${id}-${now.getTime().toString(36)}`;
}

/**
 * Sends; when Gmail's answer is lost, looks for the message in Sent before
 * deciding. Found means it went. Not found throws NOT_IN_SENT, and a failed
 * look throws UNSURE_SENT; both reach the owner as the reason it stopped.
 */
async function sendOrFind(token: string, raw: string, threadId: string | null, lookup: { to: string; subject: string; ref: string }) {
  try {
    return await sendMessage(token, raw, threadId);
  } catch (error) {
    if (!(error instanceof GmailSendUncertainError)) throw error;
  }
  let found: { id: string; threadId: string } | null;
  try {
    found = await findSentByRef(token, lookup);
  } catch (error) {
    console.error('Checking Sent after a lost Gmail answer failed', error);
    throw new SendRefusal(UNSURE_SENT);
  }
  if (!found) throw new SendRefusal(NOT_IN_SENT);
  return found;
}

// ─── Applications ─────────────────────────────────────────────────────────

type Context = {
  client: CareerDb;
  userId: string;
  app: CareerApplication;
  job: CareerJob;
  row: CareerRow & { profile: CareerProfile };
  now: Date;
};

/**
 * ready → sending, once. A `sending` left behind by a request that died more
 * than five minutes ago is taken over too, so a crash can't strand it.
 */
async function claimSend(client: CareerDb, userId: string, applicationId: string, now: Date): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - STALE_SENDING_MS).toISOString();
  const { data, error } = await client.from('career_applications').update({ status: 'sending' })
    .eq('user_id', userId).eq('id', applicationId)
    .or(`status.eq.ready,and(status.eq.sending,updated_at.lt."${staleBefore}")`)
    .select('id');
  if (error) {
    console.error('Claiming an application for sending failed', error);
    throw new SendRefusal(NOTHING_WENT);
  }
  return Boolean(data?.length);
}

/** Back to ready after something went wrong before anything went out, with a note saying what. Never throws. */
async function release(ctx: Context, message: string | null) {
  try {
    await transitionApplication(ctx.client, ctx.userId, ctx.app.id, ['sending'], 'ready');
    if (message) await addEvent(ctx.userId, { applicationId: ctx.app.id, kind: 'note', summary: `Send stopped: ${message}` }, ctx.client);
  } catch (error) {
    console.error('Putting an application back to ready failed', error);
  }
}

async function snapshotPrediction(ctx: Context, route: ApplyRoute) {
  if (!ctx.row.spec) return ctx.app.prediction;
  try {
    return await predictionFor(ctx.client, ctx.userId, { job: ctx.job, route, score: ctx.job.score ?? 0, spec: ctx.row.spec, today: careerToday(ctx.now) });
  } catch (error) {
    console.error('The prediction snapshot at send failed', error);
    return ctx.app.prediction;
  }
}

/**
 * Records what already went out: sent, when, the thread, the follow-up day,
 * the prediction at the time, a `sent` event, and the job as applied. Never
 * throws: the send can't be taken back, so a failure here is only logged.
 */
async function recordSent(ctx: Context, input: { route: ApplyRoute; threadId: string | null; followUp: boolean; summary: string; details: Record<string, unknown> }) {
  const { client, userId, app, now } = ctx;
  const patch = {
    route: input.route,
    sentAt: now.toISOString(),
    gmailThreadId: input.threadId,
    followUpDue: input.followUp ? addDays(careerToday(now), ctx.row.settings.followUpDays) : null,
    followUpDraft: null,
    prediction: await snapshotPrediction(ctx, input.route),
  };
  try {
    const moved = await transitionApplication(client, userId, app.id, ['sending'], 'sent', patch);
    if (!moved) await updateApplication(userId, app.id, { ...patch, status: 'sent' }, client);
  } catch (error) {
    console.error('Recording a sent application failed; it did go out', { applicationId: app.id, error });
  }
  try {
    await addEvent(userId, { applicationId: app.id, kind: 'sent', summary: input.summary, at: now.toISOString(), details: input.details }, client);
    await setJobState(userId, ctx.job.id, 'applied', null, client);
  } catch (error) {
    console.error('Recording the sent event failed; the application did go out', { applicationId: app.id, error });
  }
}

/** The link route, or the fallback to it: the apply page opens and waits for "I applied". */
async function openLink(ctx: Context, message?: string): Promise<SendResult> {
  const moved = await transitionApplication(ctx.client, ctx.userId, ctx.app.id, ['sending'], 'opened', { route: 'link' });
  if (!moved) await updateApplication(ctx.userId, ctx.app.id, { status: 'opened', route: 'link' }, ctx.client);
  return message ? { kind: 'opened', url: applyPage(ctx.job), message } : { kind: 'opened', url: applyPage(ctx.job) };
}

async function tailoredPdf(ctx: Context): Promise<Uint8Array> {
  const files = await getApplicationFiles(ctx.userId, ctx.app.id, ctx.client);
  if (!files?.pdfPath) throw new SendRefusal('The tailored resume is missing. Draft this application again, then send.');
  return downloadCareerFile(ctx.userId, files.pdfPath, ctx.client);
}

async function sendEmail(ctx: Context): Promise<SendResult> {
  const { job, row, app } = ctx;
  const to = applyEmailFor(job, job.requirements);
  if (!to || !validAddress(to)) return openLink(ctx, 'There’s no address to email for this job, so apply on their page instead.');
  const contact = row.profile.contact;
  const subject = applicationSubject(job.title, contact.name);
  const body = applicationBody(app.coverNote?.text ?? null, contact);
  const connection = await gmailConnection(ctx.userId);
  if (!connection?.canSend) {
    // Without the send permission the owner sends it themselves from a prefilled Gmail window.
    await release(ctx, null);
    return { kind: 'compose', url: composeUrl({ to, subject, body }) };
  }
  const pdf = await tailoredPdf(ctx);
  const token = await gmailAccessToken(ctx.userId, connection);
  const ref = messageRef('app', app.id, ctx.now);
  const raw = buildRawMessage({
    from: fromHeader(contact.name, connection.google_email),
    to,
    subject,
    text: body,
    orbisRef: ref,
    attachments: [{ filename: resumeFileName(contact.name), contentType: PDF_TYPE, data: pdf }],
  });
  const sent = await sendOrFind(token, raw, null, { to, subject, ref });
  await recordSent(ctx, {
    route: 'email',
    threadId: sent.threadId || null,
    followUp: true,
    summary: `Sent to ${to} from Gmail`,
    details: { route: 'email', to, subject, gmailId: sent.id || null, threadId: sent.threadId || null },
  });
  return { kind: 'sent' };
}

const RECRUITEE_FALLBACK = 'Sending straight to their Recruitee page didn’t work, so apply on their page instead. Everything is ready to paste.';
const RECRUITEE_UNSURE = 'Recruitee didn’t answer in time, so your application may have gone through. Check your email for their confirmation before applying on their page, then press “I applied”.';

const isTimeout = (error: unknown) => error instanceof Error && error.name === 'TimeoutError';

/**
 * Recruitee's public candidates endpoint. Its exact payload isn't verified, so
 * any answer but a 2xx (or no answer) falls back to the link route, once.
 */
async function sendRecruitee(ctx: Context): Promise<SendResult> {
  const endpoint = recruiteeEndpoint(ctx.job.recruitee);
  if (!endpoint) return openLink(ctx, 'This listing can’t take an application directly, so apply on their page instead.');
  const contact = ctx.row.profile.contact;
  const pdf = await tailoredPdf(ctx);
  const form = new FormData();
  form.set('candidate[name]', contact.name);
  form.set('candidate[email]', contact.email);
  if (contact.phone) form.set('candidate[phone]', contact.phone);
  if (ctx.app.coverNote?.text) form.set('candidate[cover_letter]', ctx.app.coverNote.text);
  form.set('candidate[cv]', new Blob([new Uint8Array(pdf)], { type: PDF_TYPE }), resumeFileName(contact.name));
  let accepted = false;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      body: form,
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(RECRUITEE_TIMEOUT_MS),
    });
    accepted = response.ok;
    if (!accepted) console.error('Recruitee refused an application', response.status);
  } catch (error) {
    console.error('Recruitee could not be reached', error);
    // The post may have landed before the answer was lost: say so, never invite a blind second try.
    if (isTimeout(error)) return openLink(ctx, RECRUITEE_UNSURE);
  }
  if (!accepted) return openLink(ctx, RECRUITEE_FALLBACK);
  await recordSent(ctx, {
    route: 'recruitee',
    threadId: null,
    followUp: true,
    summary: `Sent to ${ctx.job.company} through Recruitee`,
    details: { route: 'recruitee', host: new URL(endpoint).hostname },
  });
  return { kind: 'sent' };
}

async function sendByRoute(ctx: Context): Promise<SendResult> {
  if (ctx.app.route === 'email') return sendEmail(ctx);
  if (ctx.app.route === 'recruitee') return sendRecruitee(ctx);
  return openLink(ctx);
}

/** Why this application can't be sent now, or null when it can. */
function notSendable(app: CareerApplication, now: Date): string | null {
  if (DONE.includes(app.status)) return 'Already sent.';
  if (app.status === 'sending') {
    const fresh = now.getTime() - Date.parse(app.updatedAt) < STALE_SENDING_MS;
    return fresh ? 'This is being sent already. Give it a moment.' : null;
  }
  if (app.status !== 'ready') return 'This application isn’t ready to send yet.';
  return null;
}

/**
 * For the email route: why it mustn't go yet, or null. It goes only to the
 * address the Send bar showed (`confirm.to`), and an address Orbis hasn't sent
 * to before needs the owner's explicit confirmation. No address at all is
 * fine here: the route falls back to the apply page.
 */
async function recipientRefusal(client: CareerDb, userId: string, job: CareerJob, confirm: SendConfirmation): Promise<string | null> {
  const recipient = applyRecipient(job, 'email', await sentAddresses(userId, client));
  if (recipient.kind !== 'email') return null;
  if (senderAddress(confirm.to ?? '') !== recipient.address) return 'Where this goes has changed since the page loaded. Check the address and send again.';
  if (recipient.firstTime && confirm.confirmed !== true) return `Confirm that this should go to ${recipient.address} first.`;
  return null;
}

/**
 * The owner's Send on one application. Checks it is theirs and ready, the
 * daily cap, the recipient, claims it once, then takes its route:
 * - email: from their Gmail with the tailored PDF, or a prefilled compose
 *   window when sending isn't allowed;
 * - recruitee: Recruitee's candidates endpoint, falling back to the link;
 * - link: the apply page opens, and it waits for "I applied".
 */
export async function sendApplication(client: CareerDb, userId: string, applicationId: string, confirm: SendConfirmation = {}, now = new Date()): Promise<SendResult> {
  const app = await getApplication(userId, applicationId, client);
  if (!app) return { kind: 'refused', message: 'That application couldn’t be found.' };
  const [job, row] = await Promise.all([getJob(userId, app.jobId, client), getCareerRow(userId, client)]);
  if (!job) return { kind: 'refused', message: 'That job couldn’t be found.' };
  // Opened already: Send again just reopens the page.
  if (app.status === 'opened') return { kind: 'opened', url: applyPage(job) };
  const blocked = notSendable(app, now);
  if (blocked) return { kind: 'refused', message: blocked };
  if (!row?.profile) return { kind: 'refused', message: 'Add your resume in Career → Setup first.' };
  const sentToday = await countSentSince(userId, dayStartIso(careerToday(now)), client);
  if (sentToday >= row.settings.dailySendCap) {
    return { kind: 'refused', message: `That’s ${sentToday} sent today, your daily limit. Raise it in Career → Setup, or send tomorrow.` };
  }
  if (app.route === 'email') {
    const refusal = await recipientRefusal(client, userId, job, confirm);
    if (refusal) return { kind: 'refused', message: refusal };
  }
  if (!(await claimSend(client, userId, app.id, now))) return { kind: 'refused', message: 'This was sent or is being sent already.' };
  const ctx: Context = { client, userId, app, job, row: { ...row, profile: row.profile }, now };
  try {
    return await sendByRoute(ctx);
  } catch (error) {
    // Everything that can throw runs before the message goes; recordSent never throws.
    const message = messageOf(error);
    await release(ctx, message);
    return { kind: 'refused', message };
  }
}

/** "I applied": after a link apply or a compose window, the owner says it went. */
export async function markApplied(client: CareerDb, userId: string, applicationId: string, now = new Date()): Promise<ReplyResult> {
  const app = await getApplication(userId, applicationId, client);
  if (!app) return { ok: false, message: 'That application couldn’t be found.' };
  if (DONE.includes(app.status)) return { ok: false, message: 'Already marked as applied.' };
  if (app.status !== 'opened' && app.status !== 'ready') return { ok: false, message: 'This application isn’t ready to mark as applied.' };
  const [job, row] = await Promise.all([getJob(userId, app.jobId, client), getCareerRow(userId, client)]);
  if (!job) return { ok: false, message: 'That job couldn’t be found.' };
  let prediction = app.prediction;
  if (row?.spec) {
    prediction = await predictionFor(client, userId, { job, route: app.route, score: job.score ?? 0, spec: row.spec, today: careerToday(now) })
      .catch((error: unknown) => {
        console.error('The prediction snapshot at "I applied" failed', error);
        return app.prediction;
      });
  }
  // No follow-up day: there is no thread Orbis sent in to follow up in.
  const moved = await transitionApplication(client, userId, app.id, ['opened', 'ready'], 'sent', { sentAt: now.toISOString(), followUpDue: null, prediction });
  if (!moved) return { ok: false, message: 'Already marked as applied.' };
  await addEvent(userId, { applicationId: app.id, kind: 'sent', summary: 'You applied on their site', at: now.toISOString(), details: { route: app.route, by: 'owner' } }, client);
  await setJobState(userId, job.id, 'applied', null, client);
  return { ok: true };
}

// ─── Replies in the thread ────────────────────────────────────────────────

/** True when the same kind of reply went out moments ago: the second press of a double press. */
function justSent(events: readonly CareerEvent[], test: (event: CareerEvent) => boolean, now: Date) {
  return events.some((event) => test(event) && now.getTime() - Date.parse(event.at) < REPEAT_WINDOW_MS);
}

const isMessageId = (value: string) => /^<[^<>\s]+>$/.test(value.trim());

/** In-Reply-To and References for answering `message`, when its Message-ID is known. */
function threading(message: GmailMessageFull | null) {
  if (!message || !isMessageId(message.messageIdHeader)) return {};
  const id = message.messageIdHeader.trim();
  return { inReplyTo: id, references: replyReferences(message.references, id) };
}

async function readMessage(token: string, gmailId: string | null): Promise<GmailMessageFull | null> {
  if (!gmailId) return null;
  try {
    return await getMessageFull(token, gmailId);
  } catch (error) {
    console.error('Reading a message to reply to failed', error);
    return null;
  }
}

/**
 * Runs `work` holding the send lock for `key`; `busy` when another press
 * holds it. The lock is let go however `work` ends.
 */
async function withSendLock<T>(userId: string, key: string, applicationId: string, now: Date, work: () => Promise<T>): Promise<T | 'busy'> {
  const staleBefore = new Date(now.getTime() - LOCK_STALE_MS).toISOString();
  if (!(await claimSendLock(userId, key, applicationId, now, staleBefore))) return 'busy';
  try {
    return await work();
  } finally {
    await releaseSendLock(userId, key);
  }
}

/**
 * The follow-up the owner approved, as a reply in the same Gmail thread to
 * the last message Orbis sent there. Clears the drafted follow-up.
 */
export async function sendFollowUp(client: CareerDb, userId: string, applicationId: string, text: string, now = new Date()): Promise<ReplyResult> {
  try {
    const app = await getApplication(userId, applicationId, client);
    if (!app) return { ok: false, message: 'That application couldn’t be found.' };
    if (!FOLLOW_UP_FROM.includes(app.status)) return { ok: false, message: 'This application isn’t waiting on a reply any more.' };
    const threadId = app.gmailThreadId;
    if (!threadId) return { ok: false, message: 'This application wasn’t sent from Gmail, so there’s no thread to follow up in. Send it from your own mail.' };
    const result = await withSendLock(userId, `follow_up:${app.id}`, app.id, now, () => followUpLocked(client, userId, app, threadId, text, now));
    return result === 'busy' ? { ok: false, message: 'That follow-up is being sent already.' } : result;
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

async function followUpLocked(client: CareerDb, userId: string, app: CareerApplication, threadId: string, text: string, now: Date): Promise<ReplyResult> {
  // Read under the lock, so a press that waited sees the follow-up the first one sent.
  const [events, row, job] = await Promise.all([
    listEvents(userId, { applicationId: app.id, limit: 200 }, client),
    getCareerRow(userId, client),
    getJob(userId, app.jobId, client),
  ]);
  if (justSent(events, (event) => event.kind === 'follow_up_sent', now)) return { ok: false, message: 'That follow-up was just sent.' };
  const { token, email } = await sendingToken(userId);
  const previous = lastSentMessage(events);
  const original = await readMessage(token, previous?.gmailId ?? null);
  const to = (original?.to || previous?.to) ?? null;
  if (!to || !validAddress(to)) return { ok: false, message: 'Orbis can’t tell who the application went to. Follow up from Gmail instead.' };
  const name = row?.profile?.contact.name ?? '';
  const subject = replySubject(original?.subject || previous?.subject || applicationSubject(job?.title ?? 'your role', name));
  const ref = messageRef('fu', app.id, now);
  const raw = buildRawMessage({ from: fromHeader(name, email), to, subject, text, orbisRef: ref, ...threading(original) });
  const sent = await sendOrFind(token, raw, threadId, { to, subject, ref });
  try {
    await updateApplication(userId, app.id, { followUpDraft: null, followUpDue: null }, client);
    await addEvent(userId, {
      applicationId: app.id, kind: 'follow_up_sent', summary: 'Follow-up sent in the same thread', at: now.toISOString(),
      details: { to, subject, gmailId: sent.id || null, threadId: sent.threadId || threadId },
    }, client);
  } catch (error) {
    console.error('Recording a follow-up failed; it did go out', error);
  }
  return { ok: true };
}

/** Where the offer reply for this application goes (lib/career/recipient.ts offerReplyTarget). */
export function offerTargetFor(app: CareerApplication, job: CareerJob | null, events: readonly CareerEvent[]): ReplyTarget | null {
  const trustedDomains = job ? trustedCompanyDomains(job, applyEmailFor(job, job.requirements)) : [];
  return offerReplyTarget({ events, appThreadId: app.gmailThreadId, trustedDomains });
}

/**
 * The owner's reply to an offer: in the thread Orbis sent or the offer's own
 * thread, to the recipient offerTargetFor picks, which the screen showed
 * (`expectedTo`); if that has changed since, nothing goes.
 */
export async function sendOfferReply(
  client: CareerDb, userId: string, offerId: string, text: string, expectedTo: string | null, now = new Date(),
): Promise<ReplyResult & { applicationId?: string }> {
  try {
    const offer = await getOffer(userId, offerId, client);
    if (!offer) return { ok: false, message: 'That offer couldn’t be found.' };
    const app = await getApplication(userId, offer.applicationId, client);
    if (!app) return { ok: false, message: 'That application couldn’t be found.' };
    const result = await withSendLock(userId, `offer_reply:${offerId}`, app.id, now, () => offerReplyLocked(client, userId, { app, offerId, text, expectedTo }, now));
    if (result === 'busy') return { ok: false, message: 'That reply is being sent already.' };
    return result.ok ? { ok: true, applicationId: app.id } : result;
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

const NO_OFFER_THREAD = 'There’s no email thread for this offer in Orbis. Copy the reply and send it from your own mail.';

async function offerReplyLocked(
  client: CareerDb, userId: string, input: { app: CareerApplication; offerId: string; text: string; expectedTo: string | null }, now: Date,
): Promise<ReplyResult> {
  const { app, offerId, text } = input;
  const [events, row, job] = await Promise.all([
    listEvents(userId, { applicationId: app.id, limit: 200 }, client),
    getCareerRow(userId, client),
    getJob(userId, app.jobId, client),
  ]);
  const isOfferReply = (event: CareerEvent) => event.kind === 'note' && event.details.kind === 'offer_reply';
  if (justSent(events, isOfferReply, now)) return { ok: false, message: 'That reply was just sent.' };
  const target = offerTargetFor(app, job, events);
  if (!target || !validAddress(target.to)) return { ok: false, message: NO_OFFER_THREAD };
  if (senderAddress(input.expectedTo ?? '') !== target.to) {
    return { ok: false, message: `This reply would now go to ${target.to}. Check that’s right, then send again.` };
  }
  const { token, email } = await sendingToken(userId);
  const original = await readMessage(token, target.gmailId);
  const threadId = original?.threadId ?? target.threadId;
  if (!threadId) return { ok: false, message: NO_OFFER_THREAD };
  const to = target.to;
  const name = row?.profile?.contact.name ?? '';
  const subject = replySubject(original?.subject || `Offer for ${job?.title ?? 'the role'}`);
  const ref = messageRef('offer', offerId, now);
  const raw = buildRawMessage({ from: fromHeader(name, email), to, subject, text, orbisRef: ref, ...threading(original) });
  const sent = await sendOrFind(token, raw, threadId, { to, subject, ref });
  try {
    await addEvent(userId, {
      applicationId: app.id, kind: 'note', summary: 'Your reply to the offer was sent', at: now.toISOString(),
      details: { kind: 'offer_reply', offerId, to, subject, gmailId: sent.id || null, threadId: sent.threadId || threadId },
    }, client);
  } catch (error) {
    console.error('Recording an offer reply failed; it did go out', error);
  }
  return { ok: true };
}
