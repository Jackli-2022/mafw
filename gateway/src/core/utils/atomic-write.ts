import * as fs from 'fs';

/** Sync sleep (no timers — safe inside sync file machinery). */
function sleepSync(ms: number): void {
  if (ms <= 0) return;
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

const TRANSIENT_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);

export interface RenameWithRetryOptions {
  attempts?: number;
  sleepMs?: number;
  /** Injectable for tests; defaults to fs.renameSync. */
  rename?: (from: string, to: string) => void;
}

/**
 * Atomically renames tmpPath → targetPath, retrying briefly on Windows
 * transient locks (antivirus / indexer holding a handle on a just-written
 * file). Non-transient errors (ENOENT etc.) throw immediately.
 *
 * Why: the harmonic index save() renames a freshly written .tmp every write;
 * on Windows that occasionally fails with EPERM and kills the process.
 */
export function renameWithRetry(tmpPath: string, targetPath: string, options: RenameWithRetryOptions = {}): void {
  const attempts = Math.max(1, options.attempts ?? 5);
  const sleepMs = options.sleepMs ?? 20;
  const rename = options.rename ?? fs.renameSync;

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      rename(tmpPath, targetPath);
      return;
    } catch (err: any) {
      lastErr = err;
      if (!TRANSIENT_CODES.has(err?.code)) throw err;
      if (i < attempts - 1) sleepSync(sleepMs * (i + 1));
    }
  }
  throw lastErr;
}
