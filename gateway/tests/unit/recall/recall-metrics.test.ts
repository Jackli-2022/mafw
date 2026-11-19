/**
 * Task 1: recall stage metrics.
 *
 * The boundary recall path has a 100ms contract, but the only existing
 * instrumentation is a debug log line. These tests pin the in-memory,
 * bounded (1000-sample ring), fail-open metrics surface that the route
 * layer writes to: per-stage p50/p95/p99 plus per-request route /
 * snapshotDecision / clientAborted counters (visible-rate denominator).
 */
import {
  recordRecallStage,
  recordRecallRequest,
  resetRecallMetricsForTest,
  snapshotRecallMetrics,
} from '../../../src/recall/recall-metrics';

const STAGES = [
  'search',
  'graph',
  'expansion',
  'fok',
  'exact',
  'lexical',
  'neighbors',
  'render',
  'total',
] as const;

describe('recall-metrics', () => {
  beforeEach(() => resetRecallMetricsForTest());

  test('exposes every stage key with zeroed stats before any sample', () => {
    const snap = snapshotRecallMetrics();
    for (const stage of STAGES) {
      expect(snap.stages[stage]).toEqual({ count: 0, p50: 0, p95: 0, p99: 0, max: 0 });
    }
    expect(snap.requests.total).toBe(0);
    expect(snap.requests.visibleRate).toBe(1);
  });

  test('recordRecallStage makes p50/p95/p99 readable for that stage', () => {
    recordRecallStage('search', 12);
    recordRecallStage('search', 30);
    recordRecallStage('search', 45);

    const search = snapshotRecallMetrics().stages.search;
    expect(search.count).toBe(3);
    expect(search.max).toBe(45);
    // nearest-rank percentiles on the sorted [12, 30, 45]
    expect(search.p50).toBe(30);
    expect(search.p95).toBe(45);
    expect(search.p99).toBe(45);
    // other stages stay untouched (stages are independent distributions)
    expect(snapshotRecallMetrics().stages.fok.count).toBe(0);
  });

  test('percentiles rank unsorted multi-sample input correctly', () => {
    // 1..100 shuffled-ish: descending is enough to prove sorting
    for (let i = 100; i >= 1; i -= 1) recordRecallStage('render', i);

    const render = snapshotRecallMetrics().stages.render;
    expect(render.count).toBe(100);
    expect(render.p50).toBe(50);
    expect(render.p95).toBe(95);
    expect(render.p99).toBe(99);
    expect(render.max).toBe(100);
  });

  test('keeps only the most recent 1000 samples per stage (ring)', () => {
    for (let i = 1; i <= 1200; i += 1) recordRecallStage('total', i);

    const total = snapshotRecallMetrics().stages.total;
    expect(total.count).toBe(1000);
    // samples 201..1200 survive: p50 = 700, max = 1200
    expect(total.p50).toBe(700);
    expect(total.max).toBe(1200);
  });

  test('recordRecallRequest counts route / snapshotDecision / clientAborted and total latency', () => {
    recordRecallRequest({ route: 'fallback', snapshotDecision: 'no-snapshot', totalMs: 10 });
    recordRecallRequest({ route: 'fallback', snapshotDecision: 'topic-shift', totalMs: 20 });
    recordRecallRequest({ route: 'fallback', snapshotDecision: 'topic-shift', clientAborted: true, totalMs: 90 });
    recordRecallRequest({ route: 'snapshot', snapshotDecision: 'use', totalMs: 4 });

    const { requests, stages } = snapshotRecallMetrics();
    expect(requests.total).toBe(4);
    expect(requests.byRoute).toEqual({ snapshot: 1, fallback: 3 });
    expect(requests.bySnapshotDecision).toEqual({ 'no-snapshot': 1, 'topic-shift': 2, use: 1 });
    expect(requests.clientAborted).toBe(1);
    expect(requests.visible).toBe(3);
    expect(requests.visibleRate).toBeCloseTo(0.75, 5);
    // totalMs feeds the total stage so callers do not double-count it
    expect(stages.total.count).toBe(4);
    expect(stages.total.max).toBe(90);
  });

  test('resetRecallMetricsForTest clears stages and request counters', () => {
    recordRecallStage('exact', 7);
    recordRecallRequest({ route: 'snapshot', snapshotDecision: 'use', clientAborted: true, totalMs: 7 });

    resetRecallMetricsForTest();

    const snap = snapshotRecallMetrics();
    expect(snap.stages.exact.count).toBe(0);
    expect(snap.requests.total).toBe(0);
    expect(snap.requests.clientAborted).toBe(0);
    expect(snap.requests.byRoute).toEqual({ snapshot: 0, fallback: 0 });
    expect(snap.requests.bySnapshotDecision).toEqual({});
    expect(snap.requests.visibleRate).toBe(1);
  });

  test('snapshot is a copy: mutating it cannot corrupt later reads', () => {
    recordRecallStage('graph', 5);
    const snap = snapshotRecallMetrics();
    snap.stages.graph.count = 999;
    snap.requests.byRoute.fallback = 999;

    const again = snapshotRecallMetrics();
    expect(again.stages.graph.count).toBe(1);
    expect(again.requests.byRoute.fallback).toBe(0);
  });

  test('recording is fail-open: non-finite / negative latencies are clamped, never thrown', () => {
    expect(() => {
      recordRecallStage('search', Number.NaN);
      recordRecallStage('search', Number.POSITIVE_INFINITY);
      recordRecallStage('search', -3);
    }).not.toThrow();

    const search = snapshotRecallMetrics().stages.search;
    // NaN / Infinity are dropped; -3 survives, clamped to 0 (a negative
    // duration is a clock artifact, not a reason to lose the sample).
    expect(search.count).toBe(1);
    expect(search.max).toBe(0);
    expect(search.p50).toBe(0);
  });
});
