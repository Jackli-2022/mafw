/**
 * E4-8 kernel stats snapshot builder.
 *
 * The builder is pure: providers are injected, so every branch (including the
 * fail-open ones) is exercised without a live kernel. Wire shape is spec §4.8;
 * `buffers` stays the `BufferCounters.snapshot()` ledgers (E4-5 单一记账源).
 */
import {
  buildHandlesSnapshot,
  buildKernelStatsSnapshot,
  type KernelStatsInput,
} from '../../../src/resources/stats';

const HEAP_SAMPLE = {
  heapUsed: 10,
  heapTotal: 20,
  rss: 30,
  external: 40,
  arrayBuffers: 50,
  heapLimit: 100,
  ratio: 0.1,
  state: 'ok' as const,
};

const ZERO_BUFFERS = {
  sseOverflows: 0,
  sseDropped: 0,
  sseWriteErrors: 0,
  sseQueuedFrames: 0,
  sseQueuedBytes: 0,
  wsDropped: 0,
};

const EMPTY_CONNECTIONS = {
  httpOpen: 0,
  sse: 0,
  ws: 0,
  voice: 0,
  terminal: 0,
  limits: {
    httpConnections: 256,
    sseClients: 64,
    wsClients: 64,
    voiceClients: 16,
    terminalClients: 16,
  },
  refused: { sse: 0, ws: 0, voice: 0, terminal: 0 },
};

const EMPTY_PROCESSES = { total: 0, byKind: { python: 0, llamacpp: 0, serve: 0 }, entries: [] };

/** 除 governor/events/handles 外全部给最小可用实现（这些是必填 provider）。 */
function minimal(over: Partial<KernelStatsInput> = {}): KernelStatsInput {
  return {
    uptimeSec: 0,
    connections: { snapshot: () => EMPTY_CONNECTIONS },
    buffers: { snapshot: () => ZERO_BUFFERS },
    timers: { stats: () => ({ active: 0, byName: {} }) },
    processes: { snapshot: () => EMPTY_PROCESSES },
    quotas: { snapshot: () => ({}) },
    scheduler: { stats: () => ({ queued: 0, running: 0, byPriority: {} }) },
    events: null,
    serve: { running: false, owned: true },
    quotaCurrents: { projects: 0, sessions: 0, sessionRecordsPerProject: 0 },
    ...over,
  };
}

describe('buildKernelStatsSnapshot: full shape (spec §4.8)', () => {
  const now = Date.UTC(2026, 10, 11, 3, 4, 5);
  const snapshot = buildKernelStatsSnapshot(minimal({
    now,
    uptimeSec: 1234.9,
    governor: {
      snapshot: () => ({
        // `error` is optional on DiskSample: undefined must leave as null on the wire.
        disk: { totalBytes: 100, freeBytes: 40, state: 'warn', error: undefined },
        heap: HEAP_SAMPLE,
        pressure: { disk: 'warn', heap: 'ok', degraded: [] },
        sampledAt: now,
      }),
    },
    connections: {
      snapshot: () => ({
        ...EMPTY_CONNECTIONS,
        httpOpen: 3,
        sse: 2,
        ws: 1,
        voice: 1,
        terminal: 1,
        refused: { sse: 1, ws: 0, voice: 0, terminal: 2 },
      }),
    },
    buffers: { snapshot: () => ({ ...ZERO_BUFFERS, sseQueuedFrames: 4, sseQueuedBytes: 64, wsDropped: 2 }) },
    timers: { stats: () => ({ active: 2, byName: { 'governor:sample': 1, 'ws:ping': 1 } }) },
    processes: {
      snapshot: () => ({
        total: 1,
        byKind: { python: 1, llamacpp: 0, serve: 0 },
        entries: [{ id: 'proc-1', kind: 'python', pid: 4242, sessionId: 's1', startedAt: now }],
      }),
    },
    quotas: {
      snapshot: (currents) => ({
        projects: { current: currents.projects, limit: 128 },
        sessions: { current: currents.sessions, limit: 1000 },
        sessionRecordsPerProject: { current: currents.sessionRecordsPerProject, limit: 200 },
      }),
    },
    scheduler: { stats: () => ({ queued: 2, running: 1, byPriority: { foreground: 1, background: 2 } }) },
    events: { headSeq: () => 42, appendFailures: () => 1 },
    serve: { running: true, owned: false },
    handles: buildHandlesSnapshot(['TCPServerWrap', 'Timeout', 'Timeout'], 7),
    quotaCurrents: { projects: 2, sessions: 5, sessionRecordsPerProject: 3 },
  }));

  it('projects timestamp/uptime/pressure/disk/heap', () => {
    expect(snapshot.timestamp).toBe(new Date(now).toISOString());
    expect(snapshot.uptimeSec).toBe(1234);
    expect(snapshot.pressure).toEqual({ disk: 'warn', heap: 'ok', degraded: [] });
    // error undefined → null (schema allows string|null, never missing).
    expect(snapshot.disk).toEqual({ totalBytes: 100, freeBytes: 40, state: 'warn', error: null });
    expect(snapshot.heap).toEqual(HEAP_SAMPLE);
  });

  it('projects the live provider snapshots (connections/buffers/processes/quotas/scheduler/events/serve)', () => {
    expect(snapshot.connections).toMatchObject({ httpOpen: 3, sse: 2, ws: 1, voice: 1, terminal: 1 });
    expect(snapshot.connections.refused).toEqual({ sse: 1, ws: 0, voice: 0, terminal: 2 });
    // E4-5: buffers is the aggregate BufferCounters ledger, surfaced as provided.
    expect(snapshot.buffers).toEqual({ ...ZERO_BUFFERS, sseQueuedFrames: 4, sseQueuedBytes: 64, wsDropped: 2 });
    expect(snapshot.processes.total).toBe(1);
    expect(snapshot.processes.byKind).toEqual({ python: 1, llamacpp: 0, serve: 0 });
    expect(snapshot.processes.entries).toEqual([
      { id: 'proc-1', kind: 'python', pid: 4242, sessionId: 's1', startedAt: now },
    ]);
    expect(snapshot.quotas).toEqual({
      projects: { current: 2, limit: 128 },
      sessions: { current: 5, limit: 1000 },
      sessionRecordsPerProject: { current: 3, limit: 200 },
    });
    expect(snapshot.scheduler).toEqual({ queued: 2, running: 1, byPriority: { foreground: 1, background: 2 } });
    expect(snapshot.events).toEqual({ headSeq: 42, appendFailures: 1 });
    expect(snapshot.serve).toEqual({ running: true, owned: false });
  });

  it('hands the real timers aggregate and handles inventory through', () => {
    expect(snapshot.timers).toEqual({ active: 2, byName: { 'governor:sample': 1, 'ws:ping': 1 } });
    expect(snapshot.handles).toEqual({ total: 3, byType: { TCPServerWrap: 1, Timeout: 2 }, fdCount: 7 });
  });
});

describe('buildKernelStatsSnapshot: absent providers fail open', () => {
  const snapshot = buildKernelStatsSnapshot(minimal());

  it('defaults pressure/disk/heap when no governor is wired', () => {
    expect(snapshot.pressure).toEqual({ disk: 'unknown', heap: 'ok', degraded: [] });
    expect(snapshot.disk).toEqual({ totalBytes: 0, freeBytes: 0, state: 'unknown', error: null });
    expect(snapshot.heap).toBeNull();
  });

  it('defaults handles and a null event store without throwing', () => {
    expect(snapshot.handles).toEqual({ total: 0, byType: {} });
    expect(snapshot.events).toEqual({ headSeq: 0, appendFailures: 0 });
  });

  it('keeps governor heap null when the sampler has no heap sample yet', () => {
    const gov = buildKernelStatsSnapshot(minimal({
      governor: {
        snapshot: () => ({
          disk: { totalBytes: 0, freeBytes: 0, state: 'unknown', error: 'statfs unavailable' },
          heap: null,
          pressure: { disk: 'unknown', heap: 'ok', degraded: [] },
          sampledAt: null,
        }),
      },
    }));
    expect(gov.heap).toBeNull();
    expect(gov.disk.error).toBe('statfs unavailable');
  });

  it('reports degraded codes verbatim when the governor is critical', () => {
    const critical = buildKernelStatsSnapshot(minimal({
      governor: {
        snapshot: () => ({
          disk: { totalBytes: 1, freeBytes: 0, state: 'critical' },
          heap: HEAP_SAMPLE,
          pressure: { disk: 'critical', heap: 'critical', degraded: ['disk_critical', 'heap_critical'] },
          sampledAt: 1,
        }),
      },
    }));
    expect(critical.pressure.degraded).toEqual(['disk_critical', 'heap_critical']);
    // absent optional error → null, not undefined
    expect(critical.disk.error).toBeNull();
  });

  it('uses wall clock when now is omitted', () => {
    const before = Date.now();
    const snap = buildKernelStatsSnapshot(minimal());
    expect(new Date(snap.timestamp).getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe('timer family aggregation', () => {
  it('collapses sse:ping:<connectionId> into sse:ping and sums counts', () => {
    const snapshot = buildKernelStatsSnapshot(minimal({
      timers: {
        stats: () => ({
          active: 8,
          byName: {
            'governor:sample': 1,
            'sse:ping:c1': 1,
            'sse:ping:c2': 1,
            'sse:ping:c3': 2,
            'ws:ping': 1,
            'ws:device-cleanup': 1,
            'python:sweep': 1,
          },
        }),
      },
    }));
    expect(snapshot.timers.byName).toEqual({
      'governor:sample': 1,
      'sse:ping': 4,
      'ws:ping': 1,
      'ws:device-cleanup': 1,
      'python:sweep': 1,
    });
    expect(snapshot.timers.active).toBe(8);
  });

  it('keeps every name exact when there are no per-connection timers', () => {
    const snapshot = buildKernelStatsSnapshot(minimal({
      timers: { stats: () => ({ active: 2, byName: { 'governor:sample': 1, 'ws:ping': 1 } }) },
    }));
    expect(snapshot.timers.byName).toEqual({ 'governor:sample': 1, 'ws:ping': 1 });
    expect(snapshot.timers.active).toBe(2);
  });

  it('sums aggregated families when the provider reports no active count', () => {
    const snapshot = buildKernelStatsSnapshot(minimal({
      timers: { stats: () => ({ active: undefined as unknown as number, byName: { 'sse:ping:a': 1, 'sse:ping:b': 2 } }) },
    }));
    expect(snapshot.timers).toEqual({ active: 3, byName: { 'sse:ping': 3 } });
  });
});

describe('buildHandlesSnapshot', () => {
  it('counts by resource type and keeps the total', () => {
    expect(buildHandlesSnapshot(['TCPServerWrap', 'Timeout', 'Timeout', 'FSReqCallback'])).toEqual({
      total: 4,
      byType: { TCPServerWrap: 1, Timeout: 2, FSReqCallback: 1 },
    });
  });

  it('adds the Linux fd count only when it is a finite number', () => {
    expect(buildHandlesSnapshot(['Timeout'], 0).fdCount).toBe(0);
    expect(buildHandlesSnapshot(['Timeout'], 12).fdCount).toBe(12);
    expect('fdCount' in buildHandlesSnapshot(['Timeout'])).toBe(false);
    expect('fdCount' in buildHandlesSnapshot(['Timeout'], Number.NaN)).toBe(false);
  });

  it('returns an empty inventory for no active resources', () => {
    expect(buildHandlesSnapshot([])).toEqual({ total: 0, byType: {} });
  });
});

describe('quota object mapping', () => {
  it('reports current/limit per resource, preserving limit 0 = unlimited', () => {
    const snapshot = buildKernelStatsSnapshot(minimal({
      quotas: {
        snapshot: (currents) => ({
          projects: { current: currents.projects, limit: 0 },
          sessions: { current: currents.sessions, limit: 1000 },
        }),
      },
      quotaCurrents: { projects: 4, sessions: 7, sessionRecordsPerProject: 1 },
    }));
    expect(snapshot.quotas).toEqual({
      projects: { current: 4, limit: 0 },
      sessions: { current: 7, limit: 1000 },
    });
  });

  it('passes every quota current through to the provider', () => {
    const seen: Record<string, number>[] = [];
    buildKernelStatsSnapshot(minimal({
      quotas: {
        snapshot: (currents) => {
          seen.push(currents);
          return {};
        },
      },
      quotaCurrents: { projects: 1, sessions: 2, sessionRecordsPerProject: 3 },
    }));
    expect(seen).toEqual([{ projects: 1, sessions: 2, sessionRecordsPerProject: 3 }]);
  });
});
