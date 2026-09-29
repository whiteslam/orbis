// When the app lock guard should slide the server's unlock window forward.
// Pure, so it can be unit tested.

/** Activity more often than this does not send another heartbeat. */
export const HEARTBEAT_MS = 60_000;

/**
 * True when activity at `now` should send a heartbeat. `lastHeartbeat` is null
 * until one has been sent from this page: loading the page does not extend the
 * unlock cookie, so the first activity after a load always sends one. Otherwise
 * a page loaded late in the five-minute window would look unlocked while the
 * server refused every save until the next heartbeat, a minute later.
 */
export function heartbeatDue(lastHeartbeat: number | null, now: number) {
  return lastHeartbeat === null || now - lastHeartbeat >= HEARTBEAT_MS;
}
