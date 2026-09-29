'use server';

import { answerFromRecords, askBlockedMessage } from '@/lib/ask/answer';
import { pickSources, type AskSource, type Citation } from '@/lib/ask/select';
import { requireUser } from '@/lib/auth/session';
import { speak, transcribe } from '@/lib/voice/sarvam';
import { languageName, talkAudioProblem, trimHistory, ttsLanguage } from '@/lib/voice/talk';

/** What a spoken question looks at by default when the client sends none. The panel's
 *  chips can turn any source on or off, saved notes included — voice reads whichever
 *  sources the chips allow, same as a typed question. */
const TALK_SOURCES: AskSource[] = ['journal', 'spending', 'routines', 'steps'];

export type TalkResult = {
  success: boolean;
  message: string;
  transcript?: string;
  answer?: string;
  citations?: Citation[];
  /** BCP-47 code the answer is written and spoken in. */
  language?: string;
  /** Base64 WAV, or absent when speech failed and the client should read the text itself. */
  audio?: string;
};

function sarvamKey() {
  return process.env.SARVAM_API_KEY?.trim() || null;
}

/** Whether the mic should be shown at all. */
export async function talkAvailableAction(): Promise<boolean> {
  return !!sarvamKey() && !!(await requireUser())?.userId;
}

/**
 * One spoken turn: hear it, answer it from the user's records, say it back.
 *
 * The recording goes to Sarvam only after the AI consent check passes, and is
 * never stored: it exists for this request and nowhere else.
 */
export async function talkToOrbisAction(form: FormData): Promise<TalkResult> {
  const userId = (await requireUser())?.userId;
  if (!userId) return { success: false, message: 'Sign in again to talk to Orbis.' };
  const apiKey = sarvamKey();
  if (!apiKey) return { success: false, message: 'Voice isn’t set up yet.' };

  const file = form.get('audio');
  if (!(file instanceof Blob)) return { success: false, message: 'Orbis didn’t catch that. Try again.' };
  const problem = talkAudioProblem(file);
  if (problem) return { success: false, message: problem };

  let earlier: ReturnType<typeof trimHistory> = [];
  try {
    earlier = trimHistory(JSON.parse(String(form.get('history') ?? '[]')));
  } catch {
    earlier = [];
  }

  let sources: AskSource[] = TALK_SOURCES;
  if (form.has('sources')) {
    try {
      sources = pickSources(JSON.parse(String(form.get('sources'))));
    } catch {
      sources = [];
    }
    if (!sources.length) return { success: false, message: 'Choose at least one thing Orbis may look at.' };
  }

  const blocked = await askBlockedMessage(userId);
  if (blocked) return { success: false, message: blocked };

  const heard = await transcribe(file, { apiKey });
  if (!heard) return { success: false, message: 'Orbis didn’t catch that. Try again.' };
  const transcript = heard.transcript.slice(0, 300);
  if (transcript.length < 2) return { success: false, message: 'Orbis didn’t catch that. Try again.' };

  const language = ttsLanguage(heard.language);
  const result = await answerFromRecords({ userId, question: transcript, sources, earlier, spokenLanguage: languageName(language) });
  if (!result.success || !result.answer) return { ...result, transcript };

  const audio = await speak(result.answer, language, { apiKey });
  return { success: true, message: '', transcript, answer: result.answer, citations: result.citations, language, audio: audio ?? undefined };
}
