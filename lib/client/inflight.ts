// One request at a time per key, shared by everyone who asks while it runs.
// Today's cards fetch when they mount; switching between the Classic and Glass
// views mounts a second copy before the first answer lands. Without this, that
// second copy sends the request again (and the news one asks a model twice).

const pending = new Map<string, Promise<unknown>>();

/** Runs `load` unless a request under `key` is already running, then shares its answer (or failure). */
export function shared<T>(key: string, load: () => Promise<T>): Promise<T> {
  const running = pending.get(key) as Promise<T> | undefined;
  if (running) return running;
  const started = load().finally(() => { pending.delete(key); });
  pending.set(key, started);
  return started;
}
