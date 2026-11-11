/**
 * E4-8 GET /api/kernel/stats — registry wiring.
 *
 * The route is a thin JSON shell: `snapshot()` is the whole story (pure builder
 * covered by tests/unit/resources/stats.test.ts). Auth is the router's job, so
 * this module must not add any.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachKernelStatsRoute } from '../../../src/routes/kernel-stats';
import { KernelStatsResponse } from '../../../src/routes/schemas/resources';
import type { KernelStatsSnapshot } from '../../../src/resources/stats';

function fakeReq(url = '/api/kernel/stats'): IncomingMessage {
  return { method: 'GET', url, headers: {}, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage;
}

function fakeRes(): {
  res: ServerResponse;
  status: number;
  body: string;
  headers: Record<string, string>;
} {
  const out = { res: null as unknown as ServerResponse, status: 0, body: '', headers: {} as Record<string, string> };
  out.res = {
    writeHead: (status: number, headers?: Record<string, string>) => {
      out.status = status;
      Object.assign(out.headers, headers ?? {});
    },
    end: (payload?: unknown) => {
      out.body = String(payload ?? '');
    },
    setHeader: () => {},
  } as unknown as ServerResponse;
  return out as any;
}

const MINIMAL_SNAPSHOT: KernelStatsSnapshot = {
  timestamp: '2026-11-11T00:00:00.000Z',
  uptimeSec: 12,
  pressure: { disk: 'ok', heap: 'ok', degraded: [] },
  disk: { totalBytes: 1, freeBytes: 1, state: 'ok', error: null },
  heap: null,
  connections: {
    httpOpen: 1,
    sse: 0,
    ws: 0,
    voice: 0,
    terminal: 0,
    limits: { httpConnections: 256, sseClients: 64, wsClients: 64, voiceClients: 16, terminalClients: 16 },
    refused: { sse: 0, ws: 0, voice: 0, terminal: 0 },
  },
  buffers: { sseOverflows: 0, sseDropped: 0, sseWriteErrors: 0, sseQueuedFrames: 0, sseQueuedBytes: 0, wsDropped: 0 },
  timers: { active: 1, byName: { 'governor:sample': 1 } },
  processes: { total: 0, byKind: { python: 0, llamacpp: 0, serve: 0 }, entries: [] },
  quotas: { projects: { current: 0, limit: 128 } },
  handles: { total: 2, byType: { Timeout: 2 } },
  scheduler: { queued: 0, running: 0, byPriority: {} },
  events: { headSeq: 0, appendFailures: 0 },
  serve: { running: true, owned: true },
};

function setup(snapshot: () => KernelStatsSnapshot) {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachKernelStatsRoute(registry, { snapshot });
  return registry;
}

function invoke(registry: RouteRegistry): Promise<boolean | void> {
  const match = registry.match('GET', '/api/kernel/stats');
  expect(match?.def.handler).toBeDefined();
  return Promise.resolve(match!.def.handler!(fakeReq(), out.res, match!.params));
}

let out: ReturnType<typeof fakeRes>;

beforeEach(() => {
  out = fakeRes();
});

describe('kernel.stats route', () => {
  it('is attached to the catalog op (reachability guard anchor) and carries the 200 schema', () => {
    const registry = setup(() => MINIMAL_SNAPSHOT);
    const def = registry.list().find((d) => d.operationId === 'kernel.stats');
    expect(def).toMatchObject({
      method: 'GET',
      path: '/api/kernel/stats',
      summary: 'resource ledger snapshot',
      tags: ['internal'],
    });
    expect(def!.handler).toBeDefined();
    expect(def!.response).toBe(KernelStatsResponse);
  });

  it('writes the snapshot as 200 JSON', async () => {
    const registry = setup(() => MINIMAL_SNAPSHOT);
    await invoke(registry);
    expect(out.status).toBe(200);
    expect(out.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(out.body)).toEqual(MINIMAL_SNAPSHOT);
  });

  it('returns 500 {error} when the snapshot builder throws (never a partial body)', async () => {
    const registry = setup(() => {
      throw new Error('provider exploded');
    });
    await invoke(registry);
    expect(out.status).toBe(500);
    expect(out.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(out.body)).toEqual({ error: 'provider exploded' });
  });

  it('does not touch /api/stats (dashboard.stats stays a separate op)', () => {
    const registry = setup(() => MINIMAL_SNAPSHOT);
    const stats = registry.match('GET', '/api/stats');
    expect(stats?.def.operationId).toBe('dashboard.stats');
    expect(stats?.def.handler).toBeUndefined();
    expect(registry.match('GET', '/api/kernel/stats')?.def.operationId).toBe('kernel.stats');
  });
});
