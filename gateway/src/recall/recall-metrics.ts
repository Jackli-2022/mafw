/**
 * Task 1: recall stage metrics (in-memory, bounded, fail-open).
 *
 * The boundary recall path (`GET /api/recall/context`) has a 100ms contract
 * and a debug log line, but no aggregate view: "which stage is over budget"
 * and "how often did the client abort before receiving the body" were both
 * invisible. This module keeps the last 1000 samples per stage in a fixed-size
 * ring buffer (no unbounded growth on a long-lived gateway) plus cheap request
 * counters for route / snapshotDecision / clientAborted.
 *
 * Invariants:
 *   - Pure in-process memory; no I/O, no timers, no external dependencies.
 *   - Every entry point is fail-open: a metrics bug must never break recall,
 *     so each exported function swallows its own errors.
 *   - `recordRecallRequest` also feeds the `total` stage from `totalMs`; the
 *     route layer must not record `total` separately (that would double-count).
 */
import { log } from '../core/utils/logger';

export type RecallStageKey =
  | 'search'
  | 'graph'
  | 'expansion'
  | 'dense'
  | 'scan'
  | 'fok'
  | 'exact'
  | 'lexical'
  | 'neighbors'
  | 'render'
  | 'total';

export const RECALL_STAGE_KEYS: readonly RecallStageKey[] = [
  'search',
  'graph',
  'expansion',
  'dense',
  'scan',
  'fok',
  'exact',
  'lexical',
  'neighbors',
  'render',
  'total',
];

export type RecallSnapshotDecision = 'use' | 'stale' | 'topic-shift' | 'fok' | 'no-snapshot' | 'current-query-filter';

export interface RecallRequestMetrics {
  route: 'snapshot' | 'fallback';
  snapshotDecision?: RecallSnapshotDecision;
  clientAborted?: boolean;
  totalMs: number;
}

export interface RecallStageStats {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface RecallMetricsSnapshot {
  stages: Record<RecallStageKey, RecallStageStats>;
  requests: {
    /** Requests recorded since the last reset (counters are cumulative). */
    total: number;
    /** total - clientAborted: responses the client actually received. */
    visible: number;
    /** visible / total; 1 when nothing has been recorded yet. */
    visibleRate: number;
    clientAborted: number;
    byRoute: { snapshot: number; fallback: number };
    bySnapshotDecision: Record<string, number>;
  };
}

/** Fixed ring capacity: the window that p50/p95/p99 are computed over. */
export const RECALL_METRICS_WINDOW = 1000;

class StageRing {
  private readonly buf = new Float64Array(RECALL_METRICS_WINDOW);
  private next = 0;
  private size = 0;

  push(value: number): void {
    this.buf[this.next] = value;
    this.next = (this.next + 1) % RECALL_METRICS_WINDOW;
    if (this.size < RECALL_METRICS_WINDOW) this.size += 1;
  }

  /** Values in the window; order is irrelevant (callers sort). */
  values(): number[] {
    if (this.size < RECALL_METRICS_WINDOW) return Array.from(this.buf.subarray(0, this.size));
    return Array.from(this.buf);
  }

  reset(): void {
    this.next = 0;
    this.size = 0;
  }
}

const rings: Record<RecallStageKey, StageRing> = {
  search: new StageRing(),
  graph: new StageRing(),
  expansion: new StageRing(),
  dense: new StageRing(),
  scan: new StageRing(),
  fok: new StageRing(),
  exact: new StageRing(),
  lexical: new StageRing(),
  neighbors: new StageRing(),
  render: new StageRing(),
  total: new StageRing(),
};

const requestCounters = {
  total: 0,
  clientAborted: 0,
  byRoute: { snapshot: 0, fallback: 0 } as { snapshot: number; fallback: number },
  bySnapshotDecision: new Map<string, number>(),
};

/** Normalise a duration: drop non-finite artifacts, clamp negatives to 0. */
function normalizeMs(ms: number): number | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  return ms < 0 ? 0 : ms;
}

/** Nearest-rank percentile over an ascending array (deterministic, integer). */
function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((pct / 100) * sorted.length) - 1;
  const idx = Math.min(sorted.length - 1, Math.max(0, rank));
  return sorted[idx];
}

function statsFor(ring: StageRing): RecallStageStats {
  const values = ring.values();
  if (values.length === 0) return { count: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  values.sort((a, b) => a - b);
  return {
    count: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max: values[values.length - 1],
  };
}

/** Record one stage duration (ms) into its bounded ring. Fail-open. */
export function recordRecallStage(stage: RecallStageKey, ms: number): void {
  try {
    const ring = rings[stage];
    if (!ring) return;
    const value = normalizeMs(ms);
    if (value === null) return;
    ring.push(value);
  } catch (err: any) {
    // Never let observability break the 100ms contract.
    try {
      log.debug(`[RecallMetrics] recordRecallStage failed: ${err?.message || err}`);
    } catch { /* ignore */ }
  }
}

/** Record one request outcome (route / snapshot decision / abort / total). */
export function recordRecallRequest(metrics: RecallRequestMetrics): void {
  try {
    if (!metrics || typeof metrics !== 'object') return;
    const route = metrics.route === 'snapshot' ? 'snapshot' : 'fallback';

    requestCounters.total += 1;
    requestCounters.byRoute[route] += 1;
    if (metrics.snapshotDecision) {
      const key = String(metrics.snapshotDecision);
      requestCounters.bySnapshotDecision.set(key, (requestCounters.bySnapshotDecision.get(key) ?? 0) + 1);
    }
    if (metrics.clientAborted) requestCounters.clientAborted += 1;

    const total = normalizeMs(metrics.totalMs);
    if (total !== null) rings.total.push(total);
  } catch (err: any) {
    try {
      log.debug(`[RecallMetrics] recordRecallRequest failed: ${err?.message || err}`);
    } catch { /* ignore */ }
  }
}

/** Aggregate read model. Always a fresh copy; safe to mutate by callers. */
export function snapshotRecallMetrics(): RecallMetricsSnapshot {
  const stages = {} as Record<RecallStageKey, RecallStageStats>;
  for (const key of RECALL_STAGE_KEYS) {
    try {
      stages[key] = statsFor(rings[key]);
    } catch {
      stages[key] = { count: 0, p50: 0, p95: 0, p99: 0, max: 0 };
    }
  }

  const total = requestCounters.total;
  const clientAborted = requestCounters.clientAborted;
  const visible = Math.max(0, total - clientAborted);
  const bySnapshotDecision: Record<string, number> = {};
  try {
    for (const [key, value] of requestCounters.bySnapshotDecision.entries()) {
      bySnapshotDecision[key] = value;
    }
  } catch { /* fail-open */ }

  return {
    stages,
    requests: {
      total,
      visible,
      visibleRate: total === 0 ? 1 : visible / total,
      clientAborted,
      byRoute: { snapshot: requestCounters.byRoute.snapshot, fallback: requestCounters.byRoute.fallback },
      bySnapshotDecision,
    },
  };
}

/** Test-only: clear rings and counters (keeps the module instance). */
export function resetRecallMetricsForTest(): void {
  try {
    for (const key of RECALL_STAGE_KEYS) rings[key].reset();
    requestCounters.total = 0;
    requestCounters.clientAborted = 0;
    requestCounters.byRoute.snapshot = 0;
    requestCounters.byRoute.fallback = 0;
    requestCounters.bySnapshotDecision.clear();
  } catch (err: any) {
    try {
      log.debug(`[RecallMetrics] reset failed: ${err?.message || err}`);
    } catch { /* ignore */ }
  }
}
