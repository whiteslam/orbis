'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BookOpen, Check, Clock, Copy, Flame, LoaderCircle, Mic, Pin, RotateCcw, Send, SquarePen, Square, WalletCards, X, type LucideIcon } from 'lucide-react';
import { askOrbisAction } from '@/app/ask/actions';
import { talkAvailableAction, talkToOrbisAction, type TalkResult } from '@/app/ask/talk-actions';
import { OrbisAiMark } from '@/components/brand/orbis-ai-mark';
import { safeAction } from '@/lib/client/safe-action';
import { ASK_SOURCES, type AskSource, type Citation } from '@/lib/ask/select';
import { ASK_EVENT, ASK_OPEN_EVENT, type AskAbout, type AskRequest } from '@/lib/ask/about';
import { RECORDER_PREFERENCES } from '@/lib/voice/types';
import { TALK_MAX_SECONDS, type TalkTurn } from '@/lib/voice/talk';

const SOURCE_ICONS: Record<AskSource, LucideIcon> = { journal: BookOpen, notes: Pin, spending: WalletCards, routines: Clock, steps: Flame };

/** How each source reads in a sentence: "Orbis will read your journal and spending." */
const SOURCE_WORDS: Record<AskSource, string> = { journal: 'journal', notes: 'saved notes', spending: 'spending', routines: 'routines', steps: 'steps' };

/** First questions for the empty panel, each shown only while its source is on. */
const STARTERS: Array<{ source: AskSource; question: string }> = [
  { source: 'spending', question: 'How much did I spend this week?' },
  { source: 'journal', question: 'What have I written about most this month?' },
  { source: 'routines', question: 'Which routines have I been skipping?' },
  { source: 'steps', question: 'How do my steps this week compare to last?' },
  { source: 'notes', question: 'What did I save to read later?' },
];

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking';
type Turn = TalkTurn & { language?: string; id: number; citations?: Citation[]; inferred?: string[]; followUps?: string[] };

/** "a", "a and b", "a, b and c". */
function listWords(words: string[]) {
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

function reducedMotion() {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * While the answer is on its way: the animated mark and a line naming what
 * Orbis is reading. The server reads every ticked source in one go, so the
 * line walks through them in turn and then rests on writing the answer.
 */
function Thinking({ sources, about }: Readonly<{ sources: AskSource[]; about: AskAbout | null }>) {
  const steps = [
    ...(about ? [`Reading ${ABOUT_READING[about.kind]}`] : []),
    ...sources.map((source) => `Reading your ${SOURCE_WORDS[source]}`),
    'Writing the answer',
  ];
  const [step, setStep] = useState(0);
  const last = steps.length - 1;
  useEffect(() => {
    if (step >= last) return;
    const timer = window.setTimeout(() => setStep((current) => current + 1), 900);
    return () => window.clearTimeout(timer);
  }, [step, last]);
  return (
    <div className="talk-thinking">
      <OrbisAiMark size={22} phase="thinking" />
      <span aria-hidden="true">{steps[Math.min(step, last)]}…</span>
      <span className="sr-only">Orbis is thinking</span>
    </div>
  );
}

/**
 * The answer, a few words at a time; all at once under Reduce Motion. Screen
 * readers get the whole answer at once rather than every partial version.
 */
function Reveal({ text, lang, onGrow, onDone }: Readonly<{ text: string; lang?: string; onGrow: () => void; onDone: () => void }>) {
  const words = text.split(/(\s+)/);
  const [shown, setShown] = useState(() => (reducedMotion() ? words.length : 0));
  // Long answers take the same few seconds as short ones, not a word per beat.
  const stride = Math.max(2, Math.ceil(words.length / 120));
  const grow = useRef(onGrow);
  const done = useRef(onDone);
  useEffect(() => {
    grow.current = onGrow;
    done.current = onDone;
  });
  useEffect(() => {
    if (shown >= words.length) {
      done.current();
      return;
    }
    const timer = window.setTimeout(() => setShown((count) => count + stride), 30);
    grow.current();
    return () => window.clearTimeout(timer);
  }, [shown, words.length, stride]);
  return (
    <p className="talk-a" lang={lang}>
      <span aria-hidden="true">{words.slice(0, shown).join('')}</span>
      <span className="sr-only">{text}</span>
    </p>
  );
}

/** Quieter than this (RMS, 0–1) counts as silence. */
const SILENCE_LEVEL = 0.02;
/** This much silence after speech ends the question. */
const SILENCE_MS = 1500;

function recorderType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return RECORDER_PREFERENCES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

function wavUrl(base64: string) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.codePointAt(0) ?? 0);
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}

const ABOUT_KIND: Record<AskAbout['kind'], string> = { holding: 'About your holding', market: 'About the market read', news: 'About this story' };
const ABOUT_READING: Record<AskAbout['kind'], string> = { holding: 'your holding', market: 'the market read', news: 'the story' };

/** The mic button's face: a spinner while Orbis thinks, stop while it listens. */
function MicIcon({ phase }: Readonly<{ phase: Phase }>) {
  if (phase === 'thinking') return <LoaderCircle className="workbook-spinner" size={24} />;
  if (phase === 'listening') return <Square size={20} />;
  return <Mic size={24} />;
}

/** Outside the component so the timing loop's clock reads don't read as render impurity. */
function now() {
  return Date.now();
}

/**
 * Ask Orbis: one assistant, on every screen, typed or spoken.
 *
 * The panel always shows; the mic only when voice is configured, and then it
 * answers out loud in whatever Indian language was spoken. Typed questions
 * work the same way without it. The question stops on its own after a pause;
 * tapping the mic while Orbis is speaking cuts it off and starts listening
 * again. Recordings are never kept.
 */
export function TalkToOrbis() {
  const [voice, setVoice] = useState(false);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [sources, setSources] = useState<AskSource[]>(['journal', 'spending', 'routines', 'steps']);
  const [draft, setDraft] = useState('');
  /** A headline, market reading or holding another card asked about; it rides along with each question until removed. */
  const [about, setAbout] = useState<AskAbout | null>(null);
  /** Ends the recording and discards it (panel closed, page left). */
  const stopRecording = useRef<(() => void) | null>(null);
  /** Ends the recording and sends it. */
  const finishRecording = useRef<(() => void) | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  // send() runs from the recorder's stop callback, which would see stale state;
  // the ref is the conversation it sends, kept in step with `turns`.
  const turnsRef = useRef<Turn[]>([]);
  // send() also reads what to look at through this ref, kept in step with `sources`.
  const sourcesRef = useRef(sources);
  /** Gives each turn a stable key; turns are only ever appended. */
  const nextTurnId = useRef(0);
  /** The typed question on its way, shown in the log before the answer comes back. */
  const [pending, setPending] = useState<string | null>(null);
  /** The typed question that last failed, for Retry. */
  const [failed, setFailed] = useState<string | null>(null);
  /** The turn whose answer is still being revealed; its citations and follow-ups wait for it. */
  const [revealing, setRevealing] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const log = useRef<HTMLDivElement | null>(null);

  /** Keeps the newest line in view, unless the reader has scrolled up to look back. */
  function follow(force = false) {
    const element = log.current;
    if (!element) return;
    if (force || element.scrollHeight - element.scrollTop - element.clientHeight < 96) element.scrollTop = element.scrollHeight;
  }
  useEffect(() => {
    follow(true);
  }, [turns.length, pending, phase, message]);

  useEffect(() => {
    let live = true;
    void safeAction(talkAvailableAction, () => false)().then((ok) => live && setVoice(ok));
    return () => {
      live = false;
    };
  }, []);

  // "Ask Orbis" buttons on other cards open the panel with their item attached
  // and a question ready, which can be edited before it is sent.
  useEffect(() => {
    const onAsk = (event: Event) => {
      const request = (event as CustomEvent<AskRequest>).detail;
      if (!request?.about) return;
      setAbout(request.about);
      setDraft(request.question.slice(0, 300));
      setMessage(null);
      setOpen(true);
    };
    window.addEventListener(ASK_EVENT, onAsk);
    return () => window.removeEventListener(ASK_EVENT, onAsk);
  }, []);

  // The desktop rail and palette open the panel as it is, with nothing attached,
  // and put the cursor in the question so a keyboard user can start typing.
  const typing = useRef<HTMLInputElement | null>(null);
  const [focusTyping, setFocusTyping] = useState(false);
  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      setFocusTyping(true);
    };
    window.addEventListener(ASK_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(ASK_OPEN_EVENT, onOpen);
  }, []);
  useEffect(() => {
    if (!open || !focusTyping) return;
    typing.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFocusTyping(false);
  }, [open, focusTyping]);

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

  // Escape closes the panel first when it's open over Settings — Settings'
  // own Escape handler checks for .talk-sheet and stands down while this runs.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
    form.set('sources', JSON.stringify(sourcesRef.current));
    const result = await safeAction(talkToOrbisAction)(form);
    if (!result.success || !result.answer) {
      setMessage(result.message || 'Orbis couldn’t answer that. Try again.');
      setPhase('idle');
      return;
    }
    addTurn({ question: result.transcript ?? '', answer: result.answer, language: result.language, citations: result.citations, inferred: result.inferred, followUps: result.followUps });
    say(result);
  }

  function addTurn(turn: Omit<Turn, 'id'>) {
    const id = nextTurnId.current++;
    turnsRef.current = [...turnsRef.current, { ...turn, id }];
    setTurns(turnsRef.current);
    setRevealing(id);
  }

  /** Asks a typed question: the form, a starter, a follow-up or Retry. */
  async function askQuestion(text: string) {
    const question = text.replace(/\s+/g, ' ').trim();
    if (question.length < 5 || phase === 'thinking' || phase === 'listening') return;
    silence();
    setMessage(null);
    setFailed(null);
    setDraft('');
    setPending(question);
    setPhase('thinking');
    const result = await safeAction(askOrbisAction)({ question, sources: sourcesRef.current, earlier: turnsRef.current.map(({ question: q, answer }) => ({ question: q, answer })), about });
    setPending(null);
    setPhase('idle');
    if (!result.success || !result.answer) {
      // The question goes back in the box, so it can be edited or retried.
      setDraft(question);
      setFailed(question);
      setMessage(result.message || 'Orbis couldn’t answer that. Try again.');
      return;
    }
    addTurn({ question, answer: result.answer, citations: result.citations, inferred: result.inferred, followUps: result.followUps });
  }

  function ask(event: FormEvent) {
    event.preventDefault();
    void askQuestion(draft);
  }

  function newChat() {
    stopRecording.current?.();
    silence();
    turnsRef.current = [];
    setTurns([]);
    setMessage(null);
    setFailed(null);
    setRevealing(null);
    setDraft('');
    setPhase('idle');
    typing.current?.focus({ preventScroll: true });
  }

  function copy(turn: Turn) {
    void navigator.clipboard?.writeText(turn.answer).then(() => {
      setCopied(turn.id);
      window.setTimeout(() => setCopied((current) => (current === turn.id ? null : current)), 1600);
    }, () => setMessage('Couldn’t copy. Select the answer and copy it instead.'));
  }

  function toggle(source: AskSource) {
    const next = sources.includes(source) ? sources.filter((item) => item !== source) : [...sources, source];
    sourcesRef.current = next;
    setSources(next);
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
    const startedAt = now();
    let heardSpeech = false;
    let quietSince = 0;
    let cancelled = false;

    const timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      const level = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
      const at = now();
      if (level > SILENCE_LEVEL) {
        heardSpeech = true;
        quietSince = 0;
      } else if (heardSpeech) {
        quietSince ||= at;
      }
      if ((heardSpeech && quietSince && at - quietSince > SILENCE_MS) || at - startedAt > TALK_MAX_SECONDS * 1000) finish();
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

  const starters = STARTERS.filter((starter) => sources.includes(starter.source)).slice(0, 3);
  const ticked = ASK_SOURCES.filter((source) => sources.includes(source.id)).map((source) => SOURCE_WORDS[source.id]);
  let reads = 'Orbis won’t read any of your records. Turn one on to ask about it.';
  if (ticked.length) reads = `Orbis will read your ${listWords(ticked)}, and nothing else.`;
  if (about) reads = ticked.length ? `Orbis will read ${ABOUT_READING[about.kind]} and your ${listWords(ticked)}.` : `Orbis will read ${ABOUT_READING[about.kind]} only.`;

  function onMic() {
    // Tapping while listening means "that's my question": send what was said.
    if (phase === 'listening') return finishRecording.current?.();
    if (phase === 'thinking') return;
    void listen();
  }

  return (
    <>
      {!open ? (
        <button type="button" className="talk-fab" onClick={() => setOpen(true)} aria-label="Ask Orbis">
          <OrbisAiMark size={34} />
        </button>
      ) : (
        <section className="talk-sheet" aria-label="Ask Orbis">
          <header className="talk-head">
            <strong><OrbisAiMark size={24} phase={phase} />Ask Orbis</strong>
            <span className="talk-head-tools">
              {turns.length > 0 && (
                <button type="button" onClick={newChat} aria-label="New chat" title="New chat" disabled={phase === 'thinking'}><SquarePen size={17} /></button>
              )}
              <button type="button" onClick={close} aria-label="Close"><X size={18} /></button>
            </span>
          </header>
          <div className="talk-log" ref={log} aria-live="polite">
            {!turns.length && !pending && phase !== 'thinking' && (
              <div className="talk-intro">
                <h2>What do you want to know?</h2>
                <p className="talk-hint">{`Ask about your spending, journal, saved notes, routines or steps, by typing${voice ? ' or speaking in any Indian language' : ''}. Recordings aren’t kept.`}</p>
                {!about && starters.length > 0 && (
                  <div className="talk-starters">
                    {starters.map((starter) => (
                      <button key={starter.question} type="button" onClick={() => void askQuestion(starter.question)} disabled={phase === 'listening'}>{starter.question}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {turns.map((turn, index) => {
              const settled = revealing !== turn.id;
              const latest = index === turns.length - 1;
              return (
                <div key={turn.id} className="talk-turn">
                  {turn.question && <p className="talk-q">{turn.question}</p>}
                  {settled ? (
                    <p className="talk-a" lang={turn.language}>{turn.answer}</p>
                  ) : (
                    <Reveal text={turn.answer} lang={turn.language} onGrow={() => follow()} onDone={() => setRevealing(null)} />
                  )}
                  {settled && (
                    <div className="talk-extra">
                      {!!turn.citations?.length && (
                        <div className="talk-cites">
                          <p className="talk-extra-label">From your records</p>
                          <ul>{turn.citations.map((citation) => <li key={citation.id}>{citation.label}</li>)}</ul>
                        </div>
                      )}
                      {!!turn.inferred?.length && (
                        <div className="talk-inferred">
                          <p className="talk-extra-label">Orbis’s reading</p>
                          {turn.inferred.map((line) => <p key={line}>{line}</p>)}
                        </div>
                      )}
                      <div className="talk-tools">
                        <button type="button" onClick={() => copy(turn)}>
                          {copied === turn.id ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                          {copied === turn.id ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      {latest && !!turn.followUps?.length && (
                        <div className="talk-follow" aria-label="Ask next">
                          {turn.followUps.map((question) => (
                            <button key={question} type="button" onClick={() => void askQuestion(question)} disabled={phase === 'thinking' || phase === 'listening'}>{question}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {pending && <div className="talk-turn"><p className="talk-q">{pending}</p></div>}
            {phase === 'thinking' && <Thinking sources={sources} about={about} />}
            {message && (
              <div className="talk-fail">
                <p className="talk-error" role="alert">{message}</p>
                {failed && phase === 'idle' && (
                  <button type="button" onClick={() => void askQuestion(failed)}><RotateCcw size={14} aria-hidden="true" />Retry</button>
                )}
              </div>
            )}
          </div>
          {/* What Orbis may read sits with the question, as capsules that show
              their own on/off state, rather than as a row of tabs under the title. */}
          <div className="talk-sources-wrap">
            <p className="talk-sources-label">Orbis can look at</p>
            <fieldset className="fd-chips talk-sources" aria-label="What Orbis may look at">
              {ASK_SOURCES.map((source) => {
                const Icon = SOURCE_ICONS[source.id];
                const on = sources.includes(source.id);
                return (
                  <button key={source.id} type="button" aria-pressed={on} onClick={() => toggle(source.id)} disabled={phase === 'thinking'}>
                    {on ? <Check size={14} strokeWidth={2.5} aria-hidden="true" /> : <Icon size={14} strokeWidth={2} aria-hidden="true" />}{source.label}
                  </button>
                );
              })}
            </fieldset>
            <p className="talk-reads">{reads}</p>
          </div>
          {about && (
            <div className="talk-about">
              <span className="talk-about-kind">{ABOUT_KIND[about.kind]}</span>
              <span className="talk-about-title">{about.title}</span>
              <button type="button" onClick={() => setAbout(null)} aria-label="Stop asking about this" disabled={phase === 'thinking'}><X size={14} /></button>
            </div>
          )}
          <footer className="talk-foot">
            {voice && (
              <button type="button" className={`talk-mic ${phase}`} onClick={onMic} disabled={phase === 'thinking' || !sources.length} aria-label={phase === 'listening' ? 'Done speaking' : 'Speak'}>
                <MicIcon phase={phase} />
              </button>
            )}
            <form className="talk-type" onSubmit={ask}>
              <input ref={typing} aria-label="Type a question" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={300} placeholder={phase === 'listening' ? 'Listening…' : 'Type a question'} disabled={phase === 'thinking' || phase === 'listening'} />
              <button type="submit" aria-label="Ask" disabled={draft.trim().length < 5 || (!sources.length && !about) || phase === 'thinking'}><Send size={16} /></button>
            </form>
          </footer>
        </section>
      )}
    </>
  );
}
