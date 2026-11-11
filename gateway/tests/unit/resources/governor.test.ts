/**
 * E4-2/E4-3 ResourceGovernor: disk+heap sampling, hysteresis, pressure, listeners.
 * Spec: docs/superpowers/specs/2026-11-11-gateway-e4-resource-ledger-design.md §4.2/§4.3
 */
import { ResourceGovernor, Pressure } from '../../../src/resources/governor';
import { TimerService } from '../../../src/core/timer-service';
import type { GatewayConfig } from '../../../src/config';

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

function makeConfig(): GatewayConfig['resources'] {
  return {
    sampleIntervalMs: 30000,
    disk: { warnFreeBytes: 2 * GiB, criticalFreeBytes: 512 * MiB },
    heap: { warnRatio: 0.75, criticalRatio: 0.9 },
    limits: {
      httpConnections: 256,
      sseClients: 64,
      wsClients: 64,
      voiceClients: 16,
      terminalClients: 16,
      pythonKernels: 4,
      projects: 128,
      sessions: 1000,
      sessionRecordsPerProject: 200,
    },
    buffers: { sseMaxFrames: 256, sseMaxBytes: 1048576, wsMaxBufferedBytes: 1048576 },
  };
}

interface Harness {
  governor: ResourceGovernor;
  timers: TimerService;
  config: GatewayConfig['resources'];
  state: {
    freeBytes: number;
    heapUsed: number;
    heapLimit: number;
    diskFailure: Error | null;
    statfsCalls: number;
  };
  sample(over?: Partial<Harness['state']>): Promise<Pressure>;
  setClock(value: number): void;
  clock(): number;
}

function harness(): Harness {
  let now = 1_000;
  const state = {
    freeBytes: 3 * GiB,
    heapUsed: 100,
    heapLimit: 1000,
    diskFailure: null as Error | null,
    statfsCalls: 0,
  };
  const config = makeConfig();
  const timers = new TimerService();
  const governor = new ResourceGovernor({
    dataDir: '/tmp/mafw-e4',
    config: () => config,
    timers,
    statfs: async () => {
      state.statfsCalls++;
      if (state.diskFailure) throw state.diskFailure;
      return { bsize: 1, blocks: 8 * GiB, bavail: state.freeBytes };
    },
    memoryUsage: () => ({
      rss: 500,
      heapTotal: 800,
      heapUsed: state.heapUsed,
      external: 10,
      arrayBuffers: 4,
    }) as NodeJS.MemoryUsage,
    heapLimit: () => state.heapLimit,
    now: () => now,
  });

  return {
    governor,
    timers,
    config,
    state,
    sample: async (over) => {
      Object.assign(state, over);
      return governor.sampleNow();
    },
    setClock: (value) => { now = value; },
    clock: () => now,
  };
}

describe('ResourceGovernor', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('starts fail-open: disk unknown, heap ok, nothing degraded', () => {
    const h = harness();
    expect(h.governor.pressure()).toEqual({ disk: 'unknown', heap: 'ok', degraded: [] });
    expect(h.governor.isDegraded()).toBe(false);
    expect(h.governor.snapshot()).toMatchObject({
      disk: { state: 'unknown' },
      heap: null,
      pressure: { disk: 'unknown', heap: 'ok', degraded: [] },
      sampledAt: null,
    });
  });

  test('start() samples immediately and registers governor:sample', async () => {
    const h = harness();
    await h.governor.start();

    expect(h.state.statfsCalls).toBe(1);
    expect(h.timers.stats().byName['governor:sample']).toBe(1);
    expect(h.governor.pressure().disk).toBe('ok');

    await jest.advanceTimersByTimeAsync(30000);
    expect(h.state.statfsCalls).toBe(2);

    h.governor.stop();
    await jest.advanceTimersByTimeAsync(90000);
    expect(h.state.statfsCalls).toBe(2);
    expect(h.timers.stats().active).toBe(0);
  });

  test('start() is idempotent', async () => {
    const h = harness();
    await h.governor.start();
    await expect(h.governor.start()).resolves.toBeUndefined();
    expect(h.timers.stats().byName['governor:sample']).toBe(1);
    h.governor.stop();
  });

  test('disk hysteresis: escalate immediately, recover only past 1.5x / 1.1x', async () => {
    const h = harness();
    await h.governor.start();

    // ok → warn at free <= warn (spec §8: freeBytes <= warn)
    expect((await h.sample({ freeBytes: 2 * GiB + 1 })).disk).toBe('ok');
    expect((await h.sample({ freeBytes: 2 * GiB })).disk).toBe('warn');
    // warn → critical at free <= critical
    expect((await h.sample({ freeBytes: 512 * MiB + 1 })).disk).toBe('warn');
    expect((await h.sample({ freeBytes: 512 * MiB })).disk).toBe('critical');

    // critical → warn only at critical * 1.5 (768 MiB)
    expect((await h.sample({ freeBytes: 700 * MiB })).disk).toBe('critical');
    expect((await h.sample({ freeBytes: 767 * MiB })).disk).toBe('critical');
    expect((await h.sample({ freeBytes: 768 * MiB })).disk).toBe('warn');

    // warn → ok only at warn * 1.1 (2.2 GiB)
    const warnRecovery = Math.ceil(2 * GiB * 1.1);
    expect((await h.sample({ freeBytes: 2 * GiB })).disk).toBe('warn');
    expect((await h.sample({ freeBytes: warnRecovery - 1 })).disk).toBe('warn');
    expect((await h.sample({ freeBytes: warnRecovery })).disk).toBe('ok');

    h.governor.stop();
  });

  test('heap hysteresis: escalate immediately, recover only below threshold - 0.05', async () => {
    const h = harness();

    expect((await h.sample({ heapUsed: 500 })).heap).toBe('ok');
    expect((await h.sample({ heapUsed: 750 })).heap).toBe('warn');
    expect((await h.sample({ heapUsed: 899 })).heap).toBe('warn');
    expect((await h.sample({ heapUsed: 900 })).heap).toBe('critical');

    // critical → warn only below 0.85
    expect((await h.sample({ heapUsed: 850 })).heap).toBe('critical');
    expect(h.governor.snapshot().heap?.state).toBe('critical');
    expect((await h.sample({ heapUsed: 849 })).heap).toBe('warn');

    // warn → ok only below 0.70
    expect((await h.sample({ heapUsed: 700 })).heap).toBe('warn');
    expect((await h.sample({ heapUsed: 699 })).heap).toBe('ok');
  });

  test('unknown disk is fail-open and never contributes to degraded', async () => {
    const h = harness();
    h.state.diskFailure = new Error('statfs unavailable');

    const pressure = await h.governor.sampleNow();
    expect(pressure.disk).toBe('unknown');
    expect(pressure.degraded).toEqual([]);
    expect(h.governor.isDegraded()).toBe(false);

    const snap = h.governor.snapshot();
    expect(snap.disk.state).toBe('unknown');
    expect(snap.disk.error).toBe('statfs_failed');
  });

  test('statfs failure while previously critical drops disk_critical (fail-open)', async () => {
    const h = harness();
    const critical = await h.sample({ freeBytes: 100 * MiB });
    expect(critical.disk).toBe('critical');
    expect(critical.degraded).toEqual(['disk_critical']);

    h.state.diskFailure = new Error('statfs gone');
    const degraded = await h.governor.sampleNow();
    expect(degraded.disk).toBe('unknown');
    expect(degraded.degraded).toEqual([]);
    expect(h.governor.isDegraded()).toBe(false);
  });

  test('degraded lists only critical states', async () => {
    const h = harness();

    const warn = await h.sample({ freeBytes: 1 * GiB, heapUsed: 800 });
    expect(warn).toEqual({ disk: 'warn', heap: 'warn', degraded: [] });
    expect(h.governor.isDegraded()).toBe(false);

    const critical = await h.sample({ freeBytes: 100 * MiB, heapUsed: 950 });
    expect(critical).toEqual({
      disk: 'critical',
      heap: 'critical',
      degraded: ['disk_critical', 'heap_critical'],
    });
    expect(h.governor.isDegraded()).toBe(true);
  });

  test('unknown disk + critical heap degrades on heap only', async () => {
    const h = harness();
    h.state.diskFailure = new Error('nope');
    const pressure = await h.sample({ heapUsed: 950 });
    expect(pressure.disk).toBe('unknown');
    expect(pressure.degraded).toEqual(['heap_critical']);
  });

  test('onChange fires on transitions only and unsubscribes', async () => {
    const h = harness();
    const seen: Array<[Pressure, Pressure]> = [];
    const unsubscribe = h.governor.onChange((prev, next) => seen.push([prev, next]));

    await h.sample({ freeBytes: 1 * GiB });
    expect(seen).toHaveLength(1);
    expect(seen[0][0].disk).toBe('unknown');
    expect(seen[0][1].disk).toBe('warn');

    await h.sample({ freeBytes: 1 * GiB }); // unchanged
    expect(seen).toHaveLength(1);

    await h.sample({ freeBytes: 100 * MiB });
    expect(seen).toHaveLength(2);
    expect(seen[1][1].degraded).toEqual(['disk_critical']);

    unsubscribe();
    await h.sample({ freeBytes: 3 * GiB });
    expect(seen).toHaveLength(2);
  });

  test('snapshot exposes samples, sampledAt from the injected clock, and pressure', async () => {
    const h = harness();
    h.setClock(123456);
    await h.sample({ freeBytes: 3 * GiB, heapUsed: 400 });

    const snap = h.governor.snapshot();
    expect(snap.sampledAt).toBe(123456);
    expect(snap.disk).toMatchObject({ totalBytes: 8 * GiB, freeBytes: 3 * GiB, state: 'ok' });
    expect(snap.heap).toMatchObject({ heapUsed: 400, heapLimit: 1000, ratio: 0.4, state: 'ok' });
    expect(snap.pressure).toEqual({ disk: 'ok', heap: 'ok', degraded: [] });
  });

  test('hot-reloads sampleIntervalMs on the next sample', async () => {
    const h = harness();
    await h.governor.start();
    await jest.advanceTimersByTimeAsync(30000);
    expect(h.state.statfsCalls).toBe(2);

    h.config.sampleIntervalMs = 1000;
    await h.sample({ freeBytes: 3 * GiB });

    await jest.advanceTimersByTimeAsync(1000);
    expect(h.state.statfsCalls).toBe(4);

    h.governor.stop();
  });

  test('sampleNow coalesces overlapping samples', async () => {
    const h = harness();
    const [a, b] = await Promise.all([h.governor.sampleNow(), h.governor.sampleNow()]);
    expect(a).toBe(b);
    expect(h.state.statfsCalls).toBe(1);
  });

  test('clamps invalid heap ratios and keeps critical above warn', async () => {
    const h = harness();
    // critical below warn is invalid: normalized to warn=0.6 / critical=0.65
    h.config.heap.warnRatio = 0.6;
    h.config.heap.criticalRatio = 0.5;

    expect((await h.sample({ heapUsed: 620 })).heap).toBe('warn');
    expect((await h.sample({ heapUsed: 660 })).heap).toBe('critical');

    // out-of-range ratios are clamped, never NaN/undefined
    h.config.heap.warnRatio = 1.5;
    h.config.heap.criticalRatio = NaN;
    expect((await h.sample({ heapUsed: 990 })).heap).toBe('critical');
  });

  test('a throwing listener does not break sampling or other listeners', async () => {
    const h = harness();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: Array<Pressure['disk']> = [];
    h.governor.onChange(() => { throw new Error('listener boom'); });
    h.governor.onChange((_prev, next) => seen.push(next.disk));

    const first = await h.sample({ freeBytes: 1 * GiB });
    expect(first.disk).toBe('warn');
    expect(seen).toEqual(['warn']);

    const second = await h.sample({ freeBytes: 3 * GiB });
    expect(second.disk).toBe('ok');
    expect(seen).toEqual(['warn', 'ok']);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  test('stop() is idempotent and start() restarts sampling', async () => {
    const h = harness();
    await h.governor.start();
    expect(h.state.statfsCalls).toBe(1);

    h.governor.stop();
    h.governor.stop();
    expect(h.timers.stats().active).toBe(0);
    await jest.advanceTimersByTimeAsync(60000);
    expect(h.state.statfsCalls).toBe(1);

    await h.governor.start();
    expect(h.state.statfsCalls).toBe(2);
    expect(h.timers.stats().byName['governor:sample']).toBe(1);
    await jest.advanceTimersByTimeAsync(30000);
    expect(h.state.statfsCalls).toBe(3);
    h.governor.stop();
  });

  test('self-heals the governor:sample timer after an external disposeAll', async () => {
    const h = harness();
    await h.governor.start();
    expect(h.timers.stats().byName['governor:sample']).toBe(1);

    h.timers.disposeAll();
    expect(h.timers.stats().active).toBe(0);

    await h.governor.sampleNow();
    expect(h.timers.stats().byName['governor:sample']).toBe(1);
    await jest.advanceTimersByTimeAsync(30000);
    expect(h.state.statfsCalls).toBe(3); // initial + manual + tick
    h.governor.stop();
  });

  test('a failed start (duplicate timer) leaves the governor re-startable', async () => {
    const h = harness();
    const blocker = h.timers.every('governor:sample', 60000, () => {});

    await expect(h.governor.start()).rejects.toThrow(/already registered/);
    expect(h.state.statfsCalls).toBe(0);
    expect(h.timers.stats().byName['governor:sample']).toBe(1);

    h.timers.clear(blocker);
    await h.governor.start();
    expect(h.state.statfsCalls).toBe(1);
    expect(h.timers.stats().byName['governor:sample']).toBe(1);
    h.governor.stop();
  });
});
