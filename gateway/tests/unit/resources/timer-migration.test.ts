/**
 * E4-1 Timer 迁移（spec §4.1）—— 长驻 interval 收进 `TimerService`。
 *
 * 迁移点（名字是 stats 聚合契约，不得重命名）：
 *   - `ws:ping`（30s） / `ws:device-cleanup`（60s） —— `createWsHub`
 *   - `sse:ping:<connectionId>`（15s，每连接唯一） —— `attachGlobalSse`
 *   - `python:sweep`（5min） —— `SessionKernels`
 *
 * 钉住三件事：名字精确；dispose 清本组 handle（幂等）；清掉之后回调不再触发。
 * 未注入 `timers` 时退回本地 setInterval（旧行为，已有测试覆盖）。
 */
import * as http from 'http';
import { PassThrough } from 'stream';
import type { WsHubDeps } from '../../../src/http/ws-upgrade';
import { createWsHub } from '../../../src/http/ws-upgrade';
import { attachGlobalSse, SSE_PING_INTERVAL_MS } from '../../../src/events/sse-attach';
import { SessionKernels } from '../../../src/python/kernel-service';
import { TimerService } from '../../../src/core/timer-service';
import { buildKernelStatsSnapshot, type KernelStatsInput } from '../../../src/resources/stats';

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

const ZERO_BUFFERS = {
  sseOverflows: 0,
  sseDropped: 0,
  sseWriteErrors: 0,
  sseQueuedFrames: 0,
  sseQueuedBytes: 0,
  wsDropped: 0,
};

/** stats 输入：除 timers 外全部最小可用（与 stats.test.ts 同口径）。 */
function statsInput(timers: TimerService): KernelStatsInput {
  return {
    uptimeSec: 0,
    connections: { snapshot: () => EMPTY_CONNECTIONS },
    buffers: { snapshot: () => ZERO_BUFFERS },
    timers,
    processes: { snapshot: () => ({ total: 0, byKind: {}, entries: [] }) },
    quotas: {
      snapshot: () => ({
        projects: { current: 0, limit: 128 },
        sessions: { current: 0, limit: 1000 },
        sessionRecordsPerProject: { current: 0, limit: 200 },
      }),
    },
    scheduler: { stats: () => ({ queued: 0, running: 0, byPriority: {} }) },
    events: null,
    serve: { running: false, owned: true },
    quotaCurrents: { projects: 0, sessions: 0, sessionRecordsPerProject: 0 },
  };
}

// ── WS hub ─────────────────────────────────────────────────────────────────

function wsDeps(timers: TimerService, spies: { cleanupStale: jest.Mock }) {
  const deps: WsHubDeps = {
    wsClients: new Set() as never,
    apiToken: () => 'sekret',
    pushGateway: () => ({
      addOnlineWs: jest.fn(),
      removeOnlineWs: jest.fn(),
      cleanupStale: spies.cleanupStale,
      syncLastSeenToDeviceStore: jest.fn(),
      pruneDeviceStore: jest.fn(() => []),
    }) as never,
    handleWsMessage: jest.fn(),
    getVoiceRuntime: jest.fn(async () => ({ createSession: jest.fn() })),
    getTerminalService: jest.fn(() => ({ bridge: jest.fn(async () => undefined) })),
    pluginWebDeps: jest.fn(() => ({}) as never),
    timers,
  };
  return deps;
}

describe('ws hub timers (E4-1)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('registers ws:ping (30s) + ws:device-cleanup (60s) by exact name, clears both on dispose', () => {
    const timers = new TimerService();
    const cleanupStale = jest.fn();
    const server = http.createServer();
    const hub = createWsHub(server, wsDeps(timers, { cleanupStale }));

    expect(timers.stats()).toEqual({
      active: 2,
      byName: { 'ws:ping': 1, 'ws:device-cleanup': 1 },
    });

    // Both cadences still fire while the hub is alive: 30s ping, 60s cleanup.
    jest.advanceTimersByTime(60_000);
    expect(cleanupStale).toHaveBeenCalledTimes(1);

    hub.dispose();
    hub.dispose(); // idempotent
    expect(timers.stats()).toEqual({ active: 0, byName: {} });

    // No callback after dispose.
    jest.advanceTimersByTime(300_000);
    expect(cleanupStale).toHaveBeenCalledTimes(1);
    server.removeAllListeners();
  });

  it('does not register into the service when timers is omitted (local fallback)', () => {
    const server = http.createServer();
    const hub = createWsHub(server, {
      ...wsDeps(new TimerService(), { cleanupStale: jest.fn() }),
      timers: undefined,
    });
    // Fallback path still creates exactly two local intervals; dispose is safe.
    expect(jest.getTimerCount()).toBe(2);
    hub.dispose();
    expect(jest.getTimerCount()).toBe(0);
    server.removeAllListeners();
  });
});

// ── SSE keepalive ──────────────────────────────────────────────────────────

function fakeSseRes(): any {
  const res = new PassThrough() as any;
  res.status = undefined;
  res.headers = {};
  res.chunks = [];
  res.writeHead = (status: number, headers?: Record<string, string>) => {
    res.status = status;
    res.headers = headers ?? {};
    return res;
  };
  res.on('data', (c: Buffer) => res.chunks.push(c.toString()));
  return res;
}

function attachSse(res: any, timers: TimerService) {
  return attachGlobalSse({
    res,
    store: null,
    replayLimit: 10,
    writeFrame: (r, frame) => { if (frame) r.write(frame); },
    since: null,
    timers,
  });
}

describe('sse keepalive timers (E4-1)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('gives every connection its own sse:ping:<id> and clears it on dispose', () => {
    const timers = new TimerService();
    const aRes = fakeSseRes();
    const bRes = fakeSseRes();
    const a = attachSse(aRes, timers);
    const b = attachSse(bRes, timers);

    const names = Object.keys(timers.stats().byName);
    expect(names).toHaveLength(2);
    for (const name of names) expect(name.startsWith('sse:ping:')).toBe(true);
    expect(new Set(names).size).toBe(2);
    expect(timers.stats().active).toBe(2);

    a.dispose();
    a.dispose(); // idempotent
    const remaining = Object.keys(timers.stats().byName);
    expect(remaining).toHaveLength(1);
    expect(new Set(names).has(remaining[0])).toBe(true);

    // The disposed connection no longer pings; the other one still does.
    const pings = (res: any) => res.chunks.join('').match(/: ping\n\n/g)?.length ?? 0;
    jest.advanceTimersByTime(SSE_PING_INTERVAL_MS);
    expect(pings(aRes)).toBe(0);
    expect(pings(bRes)).toBe(1);
    expect(timers.stats().active).toBe(1);

    b.dispose();
    expect(timers.stats()).toEqual({ active: 0, byName: {} });
  });

  it('stops writing : ping after dispose', () => {
    const timers = new TimerService();
    const res = fakeSseRes();
    const conn = attachSse(res, timers);

    jest.advanceTimersByTime(SSE_PING_INTERVAL_MS);
    expect(res.chunks.join('').match(/: ping\n\n/g)).toHaveLength(1);

    conn.dispose();
    jest.advanceTimersByTime(SSE_PING_INTERVAL_MS * 3);
    expect(res.chunks.join('').match(/: ping\n\n/g)).toHaveLength(1);
  });

  it('aggregates two live connections as sse:ping: 2 in the stats builder', () => {
    const timers = new TimerService();
    const a = attachSse(fakeSseRes(), timers);
    const b = attachSse(fakeSseRes(), timers);

    const snapshot = buildKernelStatsSnapshot(statsInput(timers));
    expect(snapshot.timers.byName['sse:ping']).toBe(2);
    expect(snapshot.timers.active).toBe(2);

    a.dispose();
    b.dispose();
    expect(buildKernelStatsSnapshot(statsInput(timers)).timers).toEqual({ active: 0, byName: {} });
  });
});

// ── Python sweep ───────────────────────────────────────────────────────────

describe('python sweep timer (E4-1)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('registers python:sweep (5min) and disposeAll clears it', () => {
    const timers = new TimerService();
    const kernels = new SessionKernels('python', { timers, maxKernels: () => 4 });
    try {
      expect(timers.stats()).toEqual({ active: 1, byName: { 'python:sweep': 1 } });
    } finally {
      kernels.disposeAll();
    }
    expect(timers.stats()).toEqual({ active: 0, byName: {} });
  });

  it('the injected timer actually drives the TTL sweep', () => {
    const timers = new TimerService();
    let now = 0;
    const kernels = new SessionKernels('python', {
      timers,
      maxKernels: () => 4,
      now: () => now,
    });
    try {
      const kernel = kernels.get('a');
      const dispose = jest.spyOn(kernel, 'dispose');

      // Not yet stale: sweep at 5 min keeps the kernel (TTL is 1h).
      jest.advanceTimersByTime(5 * 60_000);
      expect(dispose).not.toHaveBeenCalled();

      // Cross the 1h TTL, then the next 5-min tick reclaims it.
      now = 60 * 60_000 + 1;
      jest.advanceTimersByTime(5 * 60_000);
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(kernels.count()).toBe(0);
    } finally {
      kernels.disposeAll();
    }
  });
});
