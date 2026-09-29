'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LoaderCircle, Mic, Pause, Play, Square, Trash2 } from 'lucide-react';
import { deleteVoiceNoteAction, uploadVoiceNoteAction, voiceNoteUrlAction } from '@/app/personal/voice-actions';
import { safeAction } from '@/lib/client/safe-action';
import { clipLength, RECORDER_PREFERENCES, VOICE_MAX_PER_DAY, VOICE_MAX_SECONDS, type VoiceNote } from '@/lib/voice/types';

type Recording = { recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; startedAt: number };

function recorderType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return RECORDER_PREFERENCES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

/**
 * Voice notes for one journal day: record, play back, delete.
 *
 * A quick capture for when typing is too slow. Audio stays in a private bucket;
 * the play button asks for a ten-minute link only when pressed.
 */
export function VoiceNotes({ date, notes }: { date: string; notes: VoiceNote[] }) {
  const router = useRouter();
  const [recording, setRecording] = useState<Recording | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();
  const audio = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<string, string>());

  // Tick the timer while recording, and stop on its own at the limit.
  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      const seconds = (Date.now() - recording.startedAt) / 1000;
      setElapsed(seconds);
      if (seconds >= VOICE_MAX_SECONDS && recording.recorder.state === 'recording') recording.recorder.stop();
    }, 250);
    return () => window.clearInterval(timer);
  }, [recording]);

  // Leaving the screen mid-recording must release the microphone.
  useEffect(() => () => {
    recording?.stream.getTracks().forEach((track) => track.stop());
    audio.current?.pause();
  }, [recording]);

  async function start() {
    setMessage(null);
    const type = recorderType();
    if (type === null || !navigator.mediaDevices?.getUserMedia) {
      setMessage({ text: 'This browser can’t record audio.', success: false });
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setMessage({ text: 'Orbis needs microphone access to record. Allow it in your browser settings.', success: false });
      return;
    }
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const current: Recording = { recorder, stream, chunks: [], startedAt: Date.now() };
    recorder.ondataavailable = (event) => { if (event.data.size) current.chunks.push(event.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const seconds = Math.min((Date.now() - current.startedAt) / 1000, VOICE_MAX_SECONDS);
      setRecording(null);
      setElapsed(0);
      const blob = new Blob(current.chunks, { type: recorder.mimeType || type || 'audio/webm' });
      if (seconds < 1 || !blob.size) {
        setMessage({ text: 'That was too short to keep.', success: false });
        return;
      }
      const form = new FormData();
      form.set('date', date);
      form.set('duration', String(Math.round(seconds)));
      form.set('file', blob, 'voice-note');
      startTransition(async () => {
        const result = await safeAction(uploadVoiceNoteAction)(form);
        setMessage({ text: result.message, success: result.success });
        if (result.success) router.refresh();
      });
    };
    recorder.start(1000);
    setRecording(current);
  }

  function stop() {
    if (recording?.recorder.state === 'recording') recording.recorder.stop();
  }

  async function toggle(note: VoiceNote) {
    if (playing === note.id) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    let url = urls.current.get(note.id);
    if (!url) {
      const result = await safeAction(voiceNoteUrlAction)(note.id);
      if (!result.success || !result.url) {
        setMessage({ text: result.message || 'That voice note could not be loaded.', success: false });
        return;
      }
      url = result.url;
      urls.current.set(note.id, url);
    }
    audio.current?.pause();
    const player = new Audio(url);
    player.onended = () => setPlaying(null);
    player.onerror = () => {
      // The link may have expired; ask for a fresh one next time.
      urls.current.delete(note.id);
      setPlaying(null);
    };
    audio.current = player;
    setPlaying(note.id);
    player.play().catch(() => setPlaying(null));
  }

  function remove(note: VoiceNote) {
    if (!window.confirm(`Delete this ${clipLength(note.durationSeconds)} voice note?`)) return;
    if (playing === note.id) audio.current?.pause();
    startTransition(async () => {
      const result = await safeAction(deleteVoiceNoteAction)(note.id);
      setMessage({ text: result.message, success: result.success });
      if (result.success) router.refresh();
    });
  }

  const full = notes.length >= VOICE_MAX_PER_DAY;

  return (
    <div className="vn-box">
      {notes.length > 0 && (
        <ul className="vn-list" aria-label="Voice notes">
          {notes.map((note, index) => (
            <li key={note.id}>
              <button type="button" className="vn-play" onClick={() => toggle(note)} aria-label={`${playing === note.id ? 'Pause' : 'Play'} voice note ${index + 1}`}>
                {playing === note.id ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
              </button>
              <span>Voice note · {clipLength(note.durationSeconds)}</span>
              <button type="button" className="pf-delete" aria-label={`Delete voice note ${index + 1}`} onClick={() => remove(note)} disabled={isPending}><Trash2 size={13} aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      )}
      {recording ? (
        <button type="button" className="vn-record on" onClick={stop}>
          <Square size={12} aria-hidden="true" /> Stop · {clipLength(elapsed)} / {clipLength(VOICE_MAX_SECONDS)}
        </button>
      ) : isPending ? (
        <p className="vn-status"><LoaderCircle className="workbook-spinner" size={13} aria-hidden="true" /> Saving…</p>
      ) : !full ? (
        <button type="button" className="vn-record" onClick={start}><Mic size={13} aria-hidden="true" /> Record a voice note</button>
      ) : null}
      {message && <p className={`fd-msg ${message.success ? 'ok' : 'bad'}`} role="status">{message.text}</p>}
    </div>
  );
}
