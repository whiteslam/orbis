// Said wherever a Google connection (YouTube, Gmail) needs connecting again.
// Client-safe. A Google app left in Testing ends every grant after 7 days.

export const GOOGLE_RECONNECT_HINT = 'If this keeps happening about a week after each connect, your Google app is in Testing: publish it in Google Cloud → Google Auth Platform → Audience.';
