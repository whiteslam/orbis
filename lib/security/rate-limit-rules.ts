// How often each costly action may run per person, and what they are told when
// they reach the limit. Pure so it can be tested without the server.

export type RateBucket = 'uploads' | 'parse' | 'sync' | 'password' | 'social_publish_instagram' | 'social_publish_threads';

export const RATE_LIMITS: Record<RateBucket, { limit: number; windowSeconds: number }> = {
  uploads: { limit: 20, windowSeconds: 86_400 },
  parse: { limit: 20, windowSeconds: 86_400 },
  sync: { limit: 30, windowSeconds: 3_600 },
  // Re-entering the account password (changing it, deleting or exporting the
  // account). Counted per person on every check, right or wrong.
  password: { limit: 5, windowSeconds: 900 },
  // Publishing from Orbis: far under Meta's own limits, to stop a runaway retry.
  social_publish_instagram: { limit: 10, windowSeconds: 86_400 },
  social_publish_threads: { limit: 10, windowSeconds: 86_400 },
};

export function limitFor(bucket: RateBucket) {
  return { ...RATE_LIMITS[bucket] };
}

const MESSAGES: Record<RateBucket, string> = {
  uploads: 'You’ve uploaded as many files as Orbis allows in a day. Try again tomorrow.',
  parse: 'You’ve had as many files read as Orbis allows in a day. Try again tomorrow.',
  sync: 'Gmail has been synced many times in the last hour. Try again in an hour.',
  password: 'Too many password attempts. Try again in 15 minutes.',
  social_publish_instagram: 'You’ve published to Instagram from Orbis as often as it allows in a day. Try again tomorrow.',
  social_publish_threads: 'You’ve published to Threads from Orbis as often as it allows in a day. Try again tomorrow.',
};

export function rateLimitMessage(bucket: RateBucket) {
  return MESSAGES[bucket];
}

/** Shown when the limit itself can't be checked; the action is refused rather than let through. */
export const RATE_LIMIT_UNAVAILABLE_MESSAGE = 'This isn’t available right now. Try again in a little while.';
