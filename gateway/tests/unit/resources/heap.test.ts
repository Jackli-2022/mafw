/**
 * E4-3 heap sampling: process.memoryUsage + heap limit → ratio + threshold state.
 * Spec: docs/superpowers/specs/2026-11-11-gateway-e4-resource-ledger-design.md §4.3
 */
import { sampleHeap, DEFAULT_HEAP_THRESHOLDS } from '../../../src/resources/heap';

function usage(partial: Partial<NodeJS.MemoryUsage> = {}): NodeJS.MemoryUsage {
  return {
    rss: 400,
    heapTotal: 300,
    heapUsed: 100,
    external: 20,
    arrayBuffers: 5,
    ...partial,
  } as NodeJS.MemoryUsage;
}

describe('sampleHeap', () => {
  test('default thresholds are 0.75 warn / 0.9 critical', () => {
    expect(DEFAULT_HEAP_THRESHOLDS).toEqual({ warnRatio: 0.75, criticalRatio: 0.9 });
  });

  test('passes the usage fields through and computes ratio = heapUsed / heapLimit', () => {
    const sample = sampleHeap(usage({ heapUsed: 500 }), 1000);
    expect(sample).toMatchObject({
      heapUsed: 500,
      heapTotal: 300,
      rss: 400,
      external: 20,
      arrayBuffers: 5,
      heapLimit: 1000,
      ratio: 0.5,
      state: 'ok',
    });
  });

  test('threshold edges: 0.75 → warn, 0.9 → critical', () => {
    expect(sampleHeap(usage({ heapUsed: 749 }), 1000).state).toBe('ok');
    expect(sampleHeap(usage({ heapUsed: 750 }), 1000).state).toBe('warn');
    expect(sampleHeap(usage({ heapUsed: 899 }), 1000).state).toBe('warn');
    expect(sampleHeap(usage({ heapUsed: 900 }), 1000).state).toBe('critical');
    expect(sampleHeap(usage({ heapUsed: 1000 }), 1000).state).toBe('critical');
  });

  test('honours injected thresholds', () => {
    const custom = { warnRatio: 0.5, criticalRatio: 0.7 };
    expect(sampleHeap(usage({ heapUsed: 400 }), 1000, custom).state).toBe('ok');
    expect(sampleHeap(usage({ heapUsed: 500 }), 1000, custom).state).toBe('warn');
    expect(sampleHeap(usage({ heapUsed: 700 }), 1000, custom).state).toBe('critical');
  });

  test('missing arrayBuffers defaults to 0', () => {
    const sample = sampleHeap(usage({ arrayBuffers: undefined }), 1000);
    expect(sample.arrayBuffers).toBe(0);
  });

  test('heapLimit <= 0 yields ratio 0 / ok (never NaN)', () => {
    const sample = sampleHeap(usage(), 0);
    expect(sample.ratio).toBe(0);
    expect(sample.state).toBe('ok');
  });
});
