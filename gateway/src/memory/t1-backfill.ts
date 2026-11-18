/**
 * T1 vector backfill.
 *
 * The write path embeds observations fire-and-forget; a failed batch is
 * dropped, so vector coverage silently drifts behind the immutable T1 rows.
 * This pass pages through archive-first rows, skips keys already present, and
 * embeds a bounded number per run. Idempotent and fail-open: the daily decay
 * job must never fail because embedding is down.
 */
import { t1VectorKey } from '../recall/verbatim-recall';

export interface T1BackfillRow {
  observationKey: string;
  sessionId: string;
  turnId: number;
  content: string;
}

export interface T1BackfillDeps {
  listRows(offset: number, limit: number): T1BackfillRow[];
  hasVector(key: string): boolean;
  enqueue(key: string, text: string): void;
  flush(): Promise<{ indexed: number; failed: number }>;
}

export interface T1BackfillResult {
  scanned: number;
  queued: number;
  indexed: number;
  missing: number;
  failed: number;
}

export async function backfillT1Vectors(
  deps: T1BackfillDeps,
  opts: { limit?: number; pageSize?: number } = {},
): Promise<T1BackfillResult> {
  const limit = opts.limit ?? 200;
  const pageSize = Math.max(1, opts.pageSize ?? 500);
  const result: T1BackfillResult = { scanned: 0, queued: 0, indexed: 0, missing: 0, failed: 0 };
  if (limit <= 0) return result;

  let offset = 0;
  let queued = 0;
  while (queued < limit) {
    let rows: T1BackfillRow[];
    try {
      rows = deps.listRows(offset, pageSize);
    } catch {
      break;
    }
    if (!rows.length) break;
    result.scanned += rows.length;

    for (const row of rows) {
      if (queued >= limit) break;
      if (!row.content) {
        result.missing++;
        continue;
      }
      const key = t1VectorKey(row.sessionId, row.turnId, row.content);
      if (deps.hasVector(key)) continue;
      deps.enqueue(key, row.content.slice(0, 2000));
      queued++;
    }
    offset += rows.length;
  }

  result.queued = queued;
  if (queued > 0) {
    try {
      const flushed = await deps.flush();
      result.indexed = flushed.indexed;
      result.failed += flushed.failed;
    } catch {
      result.failed += queued;
    }
  }
  return result;
}
