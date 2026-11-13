// One slice of a YouTube resumable upload: open a session if there is none, then
// send the video in 8 MiB chunks until it is done or the time is up. Pure: the
// storage reads, the network, the clock and the saving are all handed in, so
// the protocol is tested without Google or Supabase.
//
// Protocol: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol

import type { Privacy, VideoDetails } from './types';

/** 8 MiB. YouTube wants every chunk but the last to be a multiple of 256 KiB. */
export const CHUNK = 8 * 1024 * 1024;

const CREATE_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const ERROR_MAX = 500;
const PRIVACIES: readonly Privacy[] = ['public', 'unlisted', 'private'];

export type UploadIo = {
  /** The bytes from start to endInclusive and the object's full size, or null when the object is missing. */
  readRange(start: number, endInclusive: number): Promise<{ bytes: Uint8Array; total: number } | null>;
  fetch: typeof fetch;
  now(): number;
  save(patch: { uploadUrl?: string | null; bytesSent?: number }): Promise<void>;
};

export type UploadRow = { uploadUrl: string | null; bytesSent: number } & VideoDetails;

export type UploadOutcome =
  | { kind: 'done'; youtubeId: string; privacy: Privacy }
  | { kind: 'partial' }
  | { kind: 'restart' } // session 404/410: url and bytes cleared
  | { kind: 'reconnect' } // 401
  | { kind: 'quota' } // 403 quotaExceeded | uploadLimitExceeded
  | { kind: 'missing' } // no object, or 0 bytes
  | { kind: 'error'; message: string };

const cut = (text: string) => {
  const points = [...text];
  return points.length > ERROR_MAX ? points.slice(0, ERROR_MAX).join('') : text;
};

const failure = (message: string): UploadOutcome => ({ kind: 'error', message: cut(message) });

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A request to YouTube that never got an answer. Anything else thrown (a failed save) is the caller's to handle. */
class Unreachable extends Error {}

async function call(io: UploadIo, url: string, init: RequestInit): Promise<Response> {
  try {
    return await io.fetch(url, init);
  } catch (error) {
    throw new Unreachable(reasonOf(error));
  }
}

type ErrorBody = { error?: { message?: unknown; errors?: { reason?: unknown; message?: unknown }[] } };

/** What a non-OK YouTube response means for this row. */
async function refusal(response: Response, onSession: boolean): Promise<UploadOutcome> {
  const text = await response.text().catch(() => '');
  let body: ErrorBody = {};
  try {
    body = JSON.parse(text) as ErrorBody;
  } catch {
    // Not JSON: the raw text, if any, is the message.
  }
  const reason = body.error?.errors?.[0]?.reason;
  if (response.status === 401) return { kind: 'reconnect' };
  if (response.status === 403 && (reason === 'quotaExceeded' || reason === 'uploadLimitExceeded')) return { kind: 'quota' };
  if (onSession && (response.status === 404 || response.status === 410)) return { kind: 'restart' };
  const message = typeof body.error?.message === 'string' && body.error.message ? body.error.message : text.trim() || response.statusText || 'no reason given';
  return failure(`YouTube said ${response.status}: ${message}`);
}

/** The next byte YouTube wants after a 308: the end of its Range plus one, or 0 when it has none. */
function nextByte(response: Response): number {
  const match = /bytes=(\d+)-(\d+)/.exec(response.headers.get('range') ?? '');
  return match ? Number(match[2]) + 1 : 0;
}

async function finished(response: Response, row: UploadRow): Promise<UploadOutcome> {
  const body = (await response.json().catch(() => ({}))) as { id?: unknown; status?: { privacyStatus?: unknown } };
  if (typeof body.id !== 'string' || !body.id) return failure(`YouTube said ${response.status}: the upload finished without a video id`);
  const privacy = PRIVACIES.find((one) => one === body.status?.privacyStatus) ?? row.privacy;
  return { kind: 'done', youtubeId: body.id, privacy };
}

async function openSession(row: UploadRow, total: number, accessToken: string, io: UploadIo): Promise<string | UploadOutcome> {
  const response = await call(io, CREATE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/mp4',
      'X-Upload-Content-Length': String(total),
    },
    body: JSON.stringify({
      snippet: { title: row.title, description: row.description, tags: row.tags, categoryId: row.categoryId, defaultLanguage: 'en' },
      status: { privacyStatus: row.privacy, selfDeclaredMadeForKids: row.madeForKids, embeddable: true },
    }),
    redirect: 'manual',
    cache: 'no-store',
  });
  if (!response.ok) return refusal(response, false);
  const location = response.headers.get('location');
  if (!location) return failure(`YouTube said ${response.status}: no upload address came back`);
  return location;
}

/** PUT to the session. A 308 is YouTube's "carry on", not a redirect, so fetch must not follow it. */
function put(uploadUrl: string, accessToken: string, contentRange: string, body: Uint8Array | null, io: UploadIo) {
  return call(io, uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'video/mp4', 'Content-Range': contentRange },
    // The bytes come from a fetched ArrayBuffer, never a shared one, which is all BodyInit rules out.
    body: (body ?? undefined) as BodyInit | undefined,
    redirect: 'manual',
    cache: 'no-store',
  });
}

/**
 * One slice of work on one row. It saves the session address as soon as it has
 * one and the byte count after every chunk YouTube accepts, so a slice that is
 * cut off loses at most the chunk in flight.
 */
export async function runUpload(row: UploadRow, accessToken: string, deadline: number, io: UploadIo): Promise<UploadOutcome> {
  let head;
  try {
    head = await io.readRange(0, 0);
  } catch (error) {
    return failure(`The video file couldn’t be read: ${reasonOf(error)}`);
  }
  if (!head || head.total <= 0) return { kind: 'missing' };
  const total = head.total;

  try {
    let uploadUrl = row.uploadUrl;
    let sent = row.bytesSent;
    if (!uploadUrl) {
      const opened = await openSession(row, total, accessToken, io);
      if (typeof opened !== 'string') return opened;
      uploadUrl = opened;
      sent = 0;
      await io.save({ uploadUrl, bytesSent: 0 });
    } else {
      // Resuming: ask YouTube how much it really has. The saved count can lag
      // if the last slice was stopped between a chunk and its save.
      const status = await put(uploadUrl, accessToken, `bytes */${total}`, null, io);
      if (status.status === 200 || status.status === 201) return finished(status, row);
      if (status.status !== 308) {
        const outcome = await refusal(status, true);
        if (outcome.kind === 'restart') await io.save({ uploadUrl: null, bytesSent: 0 });
        return outcome;
      }
      const next = nextByte(status);
      if (next !== sent) await io.save({ bytesSent: next });
      sent = next;
    }

    while (io.now() < deadline) {
      if (sent >= total) return failure(`YouTube said 308: it has all ${total} bytes but didn’t finish the upload`);
      const end = Math.min(sent + CHUNK, total) - 1;
      let chunk;
      try {
        chunk = await io.readRange(sent, end);
      } catch (error) {
        return failure(`The video file couldn’t be read: ${reasonOf(error)}`);
      }
      if (!chunk) return { kind: 'missing' };
      // Never send bytes other than the ones the Content-Range names.
      if (chunk.total !== total) return failure('The video file changed while it was uploading.');
      if (chunk.bytes.length !== end - sent + 1) return failure('The video file couldn’t be read in full.');

      const response = await put(uploadUrl, accessToken, `bytes ${sent}-${end}/${total}`, chunk.bytes, io);
      if (response.status === 200 || response.status === 201) return finished(response, row);
      if (response.status !== 308) {
        const outcome = await refusal(response, true);
        if (outcome.kind === 'restart') await io.save({ uploadUrl: null, bytesSent: 0 });
        return outcome;
      }
      sent = nextByte(response);
      await io.save({ bytesSent: sent });
    }
    return { kind: 'partial' };
  } catch (error) {
    if (error instanceof Unreachable) return failure(`Couldn’t reach YouTube: ${error.message}`);
    throw error;
  }
}

const CONTENT_RANGE = /^bytes (\d+)-(\d+)\/(\d+)$/;
const UNSATISFIED = /^bytes \*\/(\d+)$/;

/**
 * readRange over a signed storage URL, using a Range request. The size comes
 * from Content-Range. A server that ignores Range and sends the whole object is
 * handled by slicing it. 404 and 400 mean the object is missing; anything that
 * doesn't add up throws rather than hand back the wrong bytes.
 */
export function rangeReader(signedUrl: string, fetchImpl: typeof fetch): UploadIo['readRange'] {
  return async (start, endInclusive) => {
    const response = await fetchImpl(signedUrl, { headers: { Range: `bytes=${start}-${endInclusive}` }, cache: 'no-store' });
    if (response.status === 404 || response.status === 400) return null;
    const range = response.headers.get('content-range');
    if (response.status === 416) {
      // Asking for byte 0 of an empty object.
      const unsatisfied = UNSATISFIED.exec(range ?? '');
      if (unsatisfied) return { bytes: new Uint8Array(0), total: Number(unsatisfied[1]) };
      throw new Error('storage could not serve that range');
    }
    if (!response.ok) throw new Error(`storage said ${response.status}`);
    const body = new Uint8Array(await response.arrayBuffer());

    if (range) {
      const match = CONTENT_RANGE.exec(range);
      if (!match) throw new Error('storage sent an unreadable Content-Range');
      const [from, to, total] = [Number(match[1]), Number(match[2]), Number(match[3])];
      if (from !== start || to > endInclusive || body.length !== to - from + 1) throw new Error('storage sent a different range');
      return { bytes: body, total };
    }

    // No Content-Range: the server ignored Range and sent the whole object.
    const declared = response.headers.get('content-length');
    const total = declared === null ? body.length : Number(declared);
    if (!Number.isFinite(total) || total !== body.length) throw new Error('storage sent an incomplete object');
    return { bytes: body.slice(start, Math.min(endInclusive, total - 1) + 1), total };
  };
}
