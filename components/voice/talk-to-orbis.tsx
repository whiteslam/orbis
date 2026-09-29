'use client';

import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Mic, Square, X } from 'lucide-react';
import { talkAvailableAction, talkToOrbisAction, type TalkResult } from '@/app/ask/talk-actions';
import { safeAction } from '@/lib/client/safe-action';
import { RECORDER_PREFERENCES } from '@/lib/voice/types';
import { TALK_MAX_SECONDS, type TalkTurn } from '@/lib/voice/talk';

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking';
type Turn = TalkTurn & { language?: string };

/** Quieter than this (RMS, 0–1) counts as silence. */
const SILENCE_LEVEL = 0.02;
/** This much silence after speech ends the question. */
const SILENCE_MS = 1500;

function recorderType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return RECORDER_PREFERENCES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

function wavUrl(base64: string) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}

/**
 * Talk to Orbis: a mic on every screen. Speak in any Indian language and Orbis
 * answers from your records, out loud and in the same language.
 *
 * The question stops on its own after a pause; tapping the mic while Orbis is
 * speaking cuts it off and starts listening again. Recordings are never kept.
 */
export function TalkToOrbis() {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  /** Ends the recording and discards it (panel closed, page left). */
  const stopRecording = useRef<(() => void) | null>(null);
  /** Ends the recording and sends it. */
  const finishRecording = useRef<(() => void) | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  // send() runs from the recorder's stop callback, which would see stale state;
  // the ref is the conversation it sends, kept in step with `turns`.
  const turnsRef = useRef<Turn[]>([]);

  useEffect(() => {
    let live = true;
    safeAction(talkAvailableAction, () => false)().then((ok) => live && setAvailable(ok));
    return () => {
      live = false;
    };
  }, []);

  function silence() {
    player.current?.pause();
    player.current = null;
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }

  // Closing the panel or leaving the page releases the mic and stops speech.
  function close() {
    stopRecording.current?.();
    silence();
    setPhase('idle');
    setOpen(false);
  }
  useEffect(() => () => {
    stopRecording.current?.();
    silence();
  }, []);

  function say(result: TalkResult) {
    const done = () => setPhase((current) => (current === 'speaking' ? 'idle' : current));
    if (result.audio) {
      const url = wavUrl(result.audio);
      const audio = new Audio(url);
      player.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        done();
      };
      setPhase('speaking');
      audio.play().catch(done);
      return;
    }
    // Sarvam could not speak it: the browser's own voice is better than silence.
    if (typeof speechSynthesis !== 'undefined' && result.answer) {
      const utterance = new SpeechSynthesisUtterance(result.answer);
      if (result.language) utterance.lang = result.language;
      utterance.onend = done;
      setPhase('speaking');
      speechSynthesis.speak(utterance);
      return;
    }
    done();
  }

  async function send(audio: Blob) {
    setPhase('thinking');
    const form = new FormData();
    form.set('audio', audio);
    form.set('history', JSON.stringify(turnsRef.current.map(({ question, answer }) => ({ question, answer }))));
    const result = await safeAction(talkToOrbisAction)(form);
    if (!result.success || !result.answer) {
      setMessage(result.message || 'Orbis couldn’t answer that. Try again.');
      setPhase('idle');
      return;
    }
    turnsRef.current = [...turnsRef.current, { question: result.transcript ?? '', answer: result.answer, language: result.language }];
    setTurns(turnsRef.current);
    say(result);
  }

  async function listen() {
    silence();
    setMessage(null);
    const type = recorderType();
    if (type === null || !navigator.mediaDevices?.getUserMedia) {
      setMessage('This browser can’t record audio.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setMessage('Allow the microphone to talk to Orbis.');
      return;
    }

    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const startedAt = Date.now();
    let heardSpeech = false;
    let quietSince = 0;
    let cancelled = false;

    const timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      const level = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
      const now = Date.now();
      if (level > SILENCE_LEVEL) {
        heardSpeech = true;
        quietSince = 0;
      } else if (heardSpeech) {
        quietSince ||= now;
      }
      if ((heardSpeech && quietSince && now - quietSince > SILENCE_MS) || now - startedAt > TALK_MAX_SECONDS * 1000) finish();
    }, 100);

    function release() {
      window.clearInterval(timer);
      stream.getTracks().forEach((track) => track.stop());
      context.close().catch(() => {});
      stopRecording.current = null;
      finishRecording.current = null;
    }
    function finish() {
      if (recorder.state === 'recording') recorder.stop();
    }

    recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
    recorder.onstop = () => {
      release();
      if (cancelled) return;
      if (!heardSpeech) {
        setMessage('Orbis didn’t hear anything. Tap the mic and speak.');
        setPhase('idle');
        return;
      }
      void send(new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' }));
    };
    finishRecording.current = finish;
    stopRecording.current = () => {
      cancelled = true;
      finish();
      release();
    };

    recorder.start(250);
    setPhase('listening');
  }

  function onMic() {
    // Tapping while listening means "that's my question": send what was said.
    if (phase === 'listening') return finishRecording.current?.();
    if (phase === 'thinking') return;
    void listen();
  }

  if (!available) return null;

  const status = { idle: 'Tap the mic and speak', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking · tap to interrupt' }[phase];

  return (
    <>
      {!open ? (
        <button type="button" className="talk-fab" onClick={() => setOpen(true)} aria-label="Talk to Orbis">
          <Mic size={20} />
        </button>
      ) : (
        <section className="talk-sheet" aria-label="Talk to Orbis">
          <header className="talk-head">
            <strong>Talk to Orbis</strong>
            <button type="button" onClick={close} aria-label="Close"><X size={18} /></button>
          </header>
          <div className="talk-log" aria-live="polite">
            {!turns.length && <p className="talk-hint">Ask about your spending, journal, routines or steps, in any Indian language. Recordings aren’t kept.</p>}
            {turns.map((turn, index) => (
              <div key={index} className="talk-turn">
                <p className="talk-q">{turn.question}</p>
                <p className="talk-a" lang={turn.language}>{turn.answer}</p>
              </div>
            ))}
            {message && <p className="talk-error" role="alert">{message}</p>}
          </div>
          <footer className="talk-foot">
            <button type="button" className={`talk-mic ${phase}`} onClick={onMic} disabled={phase === 'thinking'} aria-label={phase === 'listening' ? 'Done speaking' : 'Speak'}>
              {phase === 'thinking' ? <LoaderCircle className="workbook-spinner" size={24} /> : phase === 'listening' ? <Square size={20} /> : <Mic size={24} />}
            </button>
            <span className="talk-status">{status}</span>
          </footer>
        </section>
      )}
    </>
  );
}
