'use client';

import { useCallback, useRef, useState } from 'react';
import { connectionMessage } from '@/lib/client/safe-action';
import type { Result } from '@/lib/career/view';

export type Notice = { text: string; ok: boolean };

/**
 * One way every Career control calls a server action: a busy key (so only the
 * pressed control spins), the result's message on failure, and a dropped
 * connection turned into the same `{ success: false }` shape instead of an
 * error boundary. A second press while one is running is ignored, which is
 * what keeps Send to one send per press.
 */
export function useRun() {
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const running = useRef(false);

  const run = useCallback(async <T,>(key: string, call: () => Promise<Result<T>>, onSuccess?: (data: T) => string | void): Promise<T | null> => {
    if (running.current) return null;
    running.current = true;
    setBusy(key);
    setNotice(null);
    let result: Result<T>;
    try {
      result = await call();
    } catch {
      result = { success: false, message: connectionMessage() };
    }
    running.current = false;
    setBusy(null);
    if (!result.success) {
      setNotice({ text: result.message, ok: false });
      return null;
    }
    const text = onSuccess?.(result.data);
    if (text) setNotice({ text, ok: true });
    return result.data;
  }, []);

  return { busy, notice, setNotice, run };
}
