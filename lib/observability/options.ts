import { scrubEvent } from './scrub';

// Shared Sentry settings for the server and the browser. Sentry 11 has no
// sendDefaultPii; what it collects is set by dataCollection, and its defaults
// collect nearly everything, so every kind is switched off here. scrubEvent in
// beforeSend is the second line of defence. Only the error, its stack and the
// route it came from are sent.
export const SENTRY_OPTIONS = {
  tracesSampleRate: 0.1,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    mcp: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
  },
  beforeSend: scrubEvent,
};
