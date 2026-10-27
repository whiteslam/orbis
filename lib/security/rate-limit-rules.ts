// How often each costly action may run per person, and what they are told when
// they reach the limit. Pure so it can be tested without the server.

export type RateBucket = 'uploads' | 'parse' | 'sync' | 'password' | 'insights' | 'career_ai' | 'career_send' | 'career_search' | 'research_run';

export const RATE_LIMITS: Record<RateBucket, { limit: number; windowSeconds: number }> = {
  uploads: { limit: 20, windowSeconds: 86_400 },
  parse: { limit: 20, windowSeconds: 86_400 },
  sync: { limit: 30, windowSeconds: 3_600 },
  // Re-entering the account password (changing it, deleting or exporting the
  // account). Counted per person on every check, right or wrong.
  password: { limit: 5, windowSeconds: 900 },
  // Each look at Social insights is a couple of dozen Meta calls, all on the user's token.
  insights: { limit: 30, windowSeconds: 3_600 },
  // Career presses that run a model (draft, rescore, read a resume, advise on
  // an offer). The AI's own daily credits are the real budget; this stops a
  // stuck button or a script from burning through them in minutes.
  career_ai: { limit: 60, windowSeconds: 3_600 },
  // Sends from Career: applications, follow-ups, offer replies. The daily send
  // cap in Career's settings is the owner's own limit; this is the backstop.
  career_send: { limit: 60, windowSeconds: 3_600 },
  // "Run a search now": a full fetch of every source plus scoring.
  career_search: { limit: 6, windowSeconds: 3_600 },
  // Research desk presses that queue a run (each is 15-25 paid model calls).
  // The monthly run cap in its settings is the real budget; this stops a
  // stuck button from queueing a dozen runs in a minute.
  research_run: { limit: 12, windowSeconds: 3_600 },
};

export function limitFor(bucket: RateBucket) {
  return { ...RATE_LIMITS[bucket] };
}

const MESSAGES: Record<RateBucket, string> = {
  uploads: 'You’ve uploaded as many files as Orbis allows in a day. Try again tomorrow.',
  parse: 'You’ve had as many files read as Orbis allows in a day. Try again tomorrow.',
  sync: 'Gmail has been synced many times in the last hour. Try again in an hour.',
  password: 'Too many password attempts. Try again in 15 minutes.',
  insights: 'Insights have been refreshed many times in the last hour. Try again later.',
  career_ai: 'Career has asked AI for a lot in the last hour. Try again in a little while.',
  career_send: 'Career has sent a lot in the last hour. Try again in a little while.',
  career_search: 'A search has run several times in the last hour. Try again in an hour.',
  research_run: 'The Research desk has started a lot of runs in the last hour. Try again in an hour.',
};

export function rateLimitMessage(bucket: RateBucket) {
  return MESSAGES[bucket];
}

/** Shown when the limit itself can't be checked; the action is refused rather than let through. */
export const RATE_LIMIT_UNAVAILABLE_MESSAGE = 'This isn’t available right now. Try again in a little while.';
