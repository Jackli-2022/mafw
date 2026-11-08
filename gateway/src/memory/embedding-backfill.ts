/**
 * Nightly embedding backfill.
 *
 * Writes are embedded fire-and-forget: a failed batch is dropped (fail-open)
 * so recall never blocks, which means vector coverage silently decays when the
 * sidecar hiccups (measured 96.5% -> 95.45% over a day). The daily decay pass
 * runs this afterwards — idempotent (existing vectors are skipped) and
 * fail-open (a backfill error must never fail the decay job).
 */
import { log } from '../core/utils/logger';

export interface BackfillRuntimeLike {
  indexer: {
    backfill(ids: string[]): Promise<{ indexed: number; skipped: number; missing: number }>;
  };
  vectors: { size(): number };
}

export interface BackfillSummary {
  ok: boolean;
  /** true when the dense channel is off — nothing to backfill. */
  skippedNoProvider: boolean;
  indexed: number;
  skipped: number;
  missing: number;
  vectors: number;
  error?: string;
}

export async function runEmbeddingBackfill(
  runtime: BackfillRuntimeLike | null | undefined,
  ids: string[],
): Promise<BackfillSummary> {
  if (!runtime) {
    return { ok: true, skippedNoProvider: true, indexed: 0, skipped: 0, missing: 0, vectors: 0 };
  }
  try {
    const res = await runtime.indexer.backfill(ids);
    const summary: BackfillSummary = {
      ok: true,
      skippedNoProvider: false,
      indexed: res.indexed,
      skipped: res.skipped,
      missing: res.missing,
      vectors: runtime.vectors.size(),
    };
    if (summary.indexed > 0 || summary.missing > 0) {
      log.info(
        `[Embedding] backfill: indexed=${summary.indexed} skipped=${summary.skipped} missing=${summary.missing} vectors=${summary.vectors}`,
      );
    }
    return summary;
  } catch (err: any) {
    const error = err?.message || String(err);
    log.warn(`[Embedding] backfill failed: ${error}`);
    return {
      ok: false,
      skippedNoProvider: false,
      indexed: 0,
      skipped: 0,
      missing: 0,
      vectors: (() => { try { return runtime.vectors.size(); } catch { return 0; } })(),
      error,
    };
  }
}
