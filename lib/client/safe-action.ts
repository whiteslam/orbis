// Server Actions reject when the request never completes (offline, dropped
// connection, server crash). Inside a React transition that rejection reaches the
// error boundary and replaces the whole app, losing whatever the user typed.
// Wrapping the call turns it into the normal `{ success: false, message }` result
// every form already knows how to show, so the draft stays and Retry works.

export const OFFLINE_MESSAGE = 'You seem to be offline. Check your connection and try again.';
export const UNREACHABLE_MESSAGE = 'Orbis couldn’t reach the server. Check your connection and try again.';

export function connectionMessage() {
  return typeof navigator !== 'undefined' && navigator.onLine === false ? OFFLINE_MESSAGE : UNREACHABLE_MESSAGE;
}

export function safeAction<Args extends unknown[], Result>(
  action: (...args: Args) => Promise<Result>,
  fallback: (message: string) => Result = (message) => ({ success: false, message }) as Result,
) {
  return async (...args: Args): Promise<Result> => {
    try {
      return await action(...args);
    } catch {
      return fallback(connectionMessage());
    }
  };
}
