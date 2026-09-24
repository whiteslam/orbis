/// <reference lib="webworker" />
// Reads an Apple Health export off the main thread so large files don't freeze the page.
// The raw export never leaves the browser; only daily totals are posted back.

import { readAppleHealthExport } from '@/lib/health/read-export';
import type { StepImportResult } from '@/lib/health/apple-steps';

export type WorkerMessage =
  | { type: 'progress'; stage: string; fraction: number }
  | { type: 'done'; result: StepImportResult }
  | { type: 'error'; message: string };

const post = (message: WorkerMessage) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);

self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const result = await readAppleHealthExport(event.data, (progress) => post({ type: 'progress', ...progress }));
    post({ type: 'done', result });
  } catch (error) {
    post({ type: 'error', message: error instanceof Error && error.message ? error.message : 'This file could not be read as an Apple Health export.' });
  }
};
