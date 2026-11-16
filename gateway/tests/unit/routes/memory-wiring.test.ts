// Phase D1 Task F1: memory query/stats registry wiring — nine legacy branches
// (merged-search / embeddings backfill / stats / sticky / get / search / delete /
// energy-distribution / l5 axioms). Load-bearing quirks: query-string parsing is
// preserved verbatim, sticky answers 503 + empty note-board shell without a
// memory service, and DELETE /api/memory/:id is method-locked (a GET on the same
// path shape has no catalog route at all).
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { config } from '../../../src/config';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachMemoryRoutes, type MemoryRouteDeps } from '../../../src/routes/memory';
import { emptyNoteBoardBudget } from '../../../src/routes/note-board';
import { setEmbeddingRuntime } from '../../../src/memory/embedding-runtime';

function fakeReq(opts: { method: string; url: string; body?: string }): IncomingMessage {
  const listeners: Record<string, Array<(c?: unknown) => void>> = {};
  const req = {
    method: opts.method,
    url: opts.url,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
    on(ev: string, fn: (c?: unknown) => void) {
      (listeners[ev] = listeners[ev] || []).push(fn);
      return req;
    },
  };
  process.nextTick(() => {
    for (const fn of listeners['data'] ?? []) fn(opts.body ?? '');
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req as unknown as IncomingMessage;
}

function fakeRes(): { res: ServerResponse; status: number; body: string } {
  const out = { res: null as unknown as ServerResponse, status: 200, body: '' };
  out.res = {
    writeHead: (status: number) => { out.status = status; },
    end: (payload?: unknown) => { out.body = String(payload ?? ''); },
    setHeader: () => {},
  } as unknown as ServerResponse;
  return out;
}

function setup(over: Partial<MemoryRouteDeps> = {}) {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-mem-routes-'));
  const deps: MemoryRouteDeps = {
    memoryService: () => null,
    consolidationService: () => null,
    heartbeat: () => null,
    coactivationGraphStore: () => null,
    fokStatsCache: () => null,
    setFokStatsCache: () => {},
    mafwDir: () => dir,
    getGatewayDb: () => ({} as any),
    backfillEmbeddings: async () => null,
    ...over,
  };
  attachMemoryRoutes(registry, deps);
  return { registry, dir };
}

const handlerFor = (registry: RouteRegistry, method: string, url: string) => {
  const m = registry.match(method as never, url);
  if (!m?.def.handler) return undefined;
  const handler = m.def.handler;
  return (req: IncomingMessage, res: ServerResponse) => handler(req, res, m.params);
};

describe('memory registry wiring (D1 Task F1)', () => {
  it('all nine catalog routes have handlers attached (no silent 404)', () => {
    const { registry } = setup();
    const expectOps: Array<[string, string, string]> = [
      ['GET', '/api/memory/merged-search', 'memory.mergedSearch'],
      ['POST', '/api/memory/embeddings/backfill', 'memory.embeddingsBackfill'],
      ['GET', '/api/memory/stats', 'memory.stats'],
      ['GET', '/api/memory/sticky', 'memory.listSticky'],
      ['GET', '/api/memory/get?id=x', 'memory.get'],
      ['GET', '/api/memory/search?query=x', 'memory.search'],
      ['DELETE', '/api/memory/abc123', 'memory.delete'],
      ['GET', '/api/memory/energy-distribution', 'memory.getEnergyDistribution'],
      ['GET', '/api/l5/axioms', 'memory.getL5Axioms'],
    ];
    for (const [method, url, op] of expectOps) {
      expect(registry.match(method as never, url)?.def.operationId).toBe(op);
      expect(handlerFor(registry, method, url)).toBeDefined();
    }
  });

  it('merged-search parses query/maxFacts and forwards them verbatim', async () => {
    const calls: Array<[string, number]> = [];
    const { registry } = setup({
      memoryService: () => ({
        mergedSearch: async (query: string, maxFacts: number) => {
          calls.push([query, maxFacts]);
          return [{ id: 'mem-1' }];
        },
      }) as any,
    });
    let r = fakeRes();
    await handlerFor(registry, 'GET', '/api/memory/merged-search?query=hello&maxFacts=7')!(
      fakeReq({ method: 'GET', url: '/api/memory/merged-search?query=hello&maxFacts=7' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ results: [{ id: 'mem-1' }] });

    r = fakeRes();
    await handlerFor(registry, 'GET', '/api/memory/merged-search')!(
      fakeReq({ method: 'GET', url: '/api/memory/merged-search' }), r.res,
    );
    // legacy default: query '' and maxFacts 5
    expect(calls).toEqual([['hello', 7], ['', 5]]);
  });

  it('merged-search without a memory service → 503 (legacy shape)', async () => {
    const { registry } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/memory/merged-search?query=x')!(
      fakeReq({ method: 'GET', url: '/api/memory/merged-search?query=x' }), r.res,
    );
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body)).toEqual({ error: 'Memory service not available' });
  });

  it('embeddings backfill parses ?limit and keeps the provider-off 400', async () => {
    const limits: Array<number | undefined> = [];
    let { registry } = setup({
      backfillEmbeddings: async (limit?: number) => { limits.push(limit); return null; },
    });
    let r = fakeRes();
    await handlerFor(registry, 'POST', '/api/memory/embeddings/backfill?limit=25')!(
      fakeReq({ method: 'POST', url: '/api/memory/embeddings/backfill?limit=25' }), r.res,
    );
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body)).toEqual({ error: 'embedding provider off (memory.embedding.provider)' });

    ({ registry } = setup({
      backfillEmbeddings: async (limit?: number) => { limits.push(limit); return { indexed: 1 }; },
    }));
    r = fakeRes();
    await handlerFor(registry, 'POST', '/api/memory/embeddings/backfill')!(
      fakeReq({ method: 'POST', url: '/api/memory/embeddings/backfill' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ indexed: 1 });
    // non-positive / non-numeric limit → undefined (legacy `!Number.isNaN && > 0`)
    expect(limits).toEqual([25, undefined]);
  });

  // ── E4-6b: disk critical → backfill 503（spec §4.2 / §6）────────────────
  it('embeddings backfill answers 503 disk_low on disk critical without starting work', async () => {
    const calls: Array<number | undefined> = [];
    const { registry } = setup({
      backfillEmbeddings: async (limit?: number) => { calls.push(limit); return { indexed: 1 }; },
      pressure: () => ({ disk: 'critical', degraded: ['disk_critical'] }),
    });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/memory/embeddings/backfill?limit=25')!(
      fakeReq({ method: 'POST', url: '/api/memory/embeddings/backfill?limit=25' }), r.res,
    );
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body)).toEqual({ error: 'disk space critical', code: 'disk_low' });
    expect(calls).toEqual([]);
  });

  it('embeddings backfill also gates on degraded containing disk_critical', async () => {
    const calls: Array<number | undefined> = [];
    const { registry } = setup({
      backfillEmbeddings: async (limit?: number) => { calls.push(limit); return { indexed: 2 }; },
      pressure: () => ({ disk: 'ok', degraded: ['disk_critical'] }),
    });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/memory/embeddings/backfill')!(
      fakeReq({ method: 'POST', url: '/api/memory/embeddings/backfill' }), r.res,
    );
    expect(r.status).toBe(503);
    expect(calls).toEqual([]);
  });

  it('embeddings backfill runs normally when pressure is ok or unknown', async () => {
    for (const pressure of [
      () => ({ disk: 'ok', degraded: [] as string[] }),
      () => null,
    ]) {
      const calls: Array<number | undefined> = [];
      const { registry } = setup({
        backfillEmbeddings: async (limit?: number) => { calls.push(limit); return { indexed: 3 }; },
        pressure,
      });
      const r = fakeRes();
      await handlerFor(registry, 'POST', '/api/memory/embeddings/backfill?limit=5')!(
        fakeReq({ method: 'POST', url: '/api/memory/embeddings/backfill?limit=5' }), r.res,
      );
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body)).toEqual({ indexed: 3 });
      expect(calls).toEqual([5]);
    }
  });

  it('stats assembles consolidation/pipelines/coactivation/abstraction buckets + fok cache', async () => {
    let cache: any = null;
    const { registry } = setup({
      memoryService: () => ({
        harmonicIndex: {
          getIndex: () => ({ entries: [{ energy: 0.9, abstraction_level: 1 }, { energy: 0.5 }] }),
        },
      }) as any,
      consolidationService: () => ({ getStats: () => ({ judged: 3 }) }) as any,
      heartbeat: () => ({ snapshot: () => [{ name: 'daily' }] }) as any,
      coactivationGraphStore: () => ({ stats: () => ({ nodes: 2 }) }) as any,
      fokStatsCache: () => cache,
      setFokStatsCache: (value) => { cache = value; },
    });
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/memory/stats')!(
      fakeReq({ method: 'GET', url: '/api/memory/stats' }), r.res,
    );
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.embedding.provider).toBe(config.memory.embedding.provider);
    expect(body.embedding.indexEntries).toBe(2);
    expect(body.consolidation).toEqual({ judged: 3 });
    expect(body.pipelines).toEqual([{ name: 'daily' }]);
    expect(body.coactivation).toEqual({ nodes: 2 });
    expect(body.abstractionLevels).toEqual({ '1': 1, '2': 0, '3': 0, unknown: 1 });
    expect(cache).not.toBeNull();
    expect(body.fok).toEqual(cache.stats);
  });

  it('search layer=t1 works without a Harmonic service and records search events', async () => {
    const recorded: any[] = [];
    const hits = [{ sessionId: 's1', turnId: 1, traceId: 't1t_a', cosine: 0.8, excerpt: 'raw' }];
    const { registry } = setup({
      searchT1: async () => hits,
      getGatewayDb: () => ({ recordT1RetrievalEvent: (e: any) => recorded.push(e) }) as any,
    });
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/memory/search?query=raw&layer=t1')!(
      fakeReq({ method: 'GET', url: '/api/memory/search?query=raw&layer=t1' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ results: [], t1Results: hits });
    expect(recorded).toEqual([{ traceId: 't1t_a', kind: 'search', score: 0.8 }]);
  });

  it('search layer=both keeps Harmonic results and appends T1', async () => {
    const { registry } = setup({
      memoryService: () => ({
        harmonicIndex: { getIndex: () => ({ entries: [] }) },
      }) as any,
      searchT1: async () => [{ sessionId: 's1', turnId: 1, traceId: 't1t_a', cosine: 0.8, excerpt: 'raw' }],
    });
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/memory/search?query=x&layer=both')!(
      fakeReq({ method: 'GET', url: '/api/memory/search?query=x&layer=both' }), r.res,
    );
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.results).toEqual([]);
    expect(body.t1Results).toHaveLength(1);
  });

  it('search default shape stays gist-only and invalid layers are rejected', async () => {
    const { registry } = setup({
      memoryService: () => ({ harmonicIndex: { getIndex: () => ({ entries: [] }) } }) as any,
    });
    let r = fakeRes();
    await handlerFor(registry, 'GET', '/api/memory/search?query=x')!(
      fakeReq({ method: 'GET', url: '/api/memory/search?query=x' }), r.res,
    );
    expect(JSON.parse(r.body)).toEqual({ results: [] });

    r = fakeRes();
    await handlerFor(registry, 'GET', '/api/memory/search?query=x&layer=nope')!(
      fakeReq({ method: 'GET', url: '/api/memory/search?query=x&layer=nope' }), r.res,
    );
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body).error).toContain('gist|t1|both');
  });

  it('stats includes T1 coverage and retrieval counters', async () => {    const since = Math.floor(Date.now() / 1000) - 7 * 86400;
    setEmbeddingRuntime({
      vectors: { size: () => 0 },
      t1Vectors: { size: () => 5 },
    } as any);
    try {
      const { registry } = setup({
        memoryService: () => ({ harmonicIndex: { getIndex: () => ({ entries: [] }) } }) as any,
        getGatewayDb: () => ({
          count: () => 3,
          archiveCount: () => 7,
          t1RetrievalStats: (_o: any) => ({
            total: 2, byKind: { search: 1, recall: 1, redeem: 0 }, uniqueTraces: 2, lastAt: 123,
          }),
          t1CodeStats: () => ({
            turns: 3, features: 3, actors: 2, concepts: 3, atomTurns: 2, atoms: 3,
          }),
        }) as any,
      });
      const r = fakeRes();
      await handlerFor(registry, 'GET', '/api/memory/stats')!(
        fakeReq({ method: 'GET', url: '/api/memory/stats' }), r.res,
      );
      const body = JSON.parse(r.body);
      expect(body.t1).toEqual({
        vectors: 5,
        activeRows: 3,
        archiveRows: 7,
        coverage: 0.5,
        retrieval: { total: 2, byKind: { search: 1, recall: 1, redeem: 0 }, uniqueTraces: 2, lastAt: 123 },
        provenance: { memories: 0, withExact: 0, coverage: 0, withEpisode: 0, episodeCoverage: 0 },
        activation: { traces: 0, mean: 0, max: 0 },
        activationRanking: { mode: 'shadow', evaluations: 0, wouldReorder: 0, applied: 0 },
        denseIndex: { mode: 'shadow', evaluations: 0, withDenseHits: 0 },
        semanticAtoms: 'on',
        atoms: { turns: 2, atoms: 3, avgPerTurn: 1.5, calibrated: false },
        code: { turns: 3, features: 3, actors: 2, concepts: 3 },
        cortex: {
          total: 0,
          active: 0,
          legacyEpisodic: 0,
          superseded: 0,
          exactGrounding: 0,
          hintGrounding: 0,
        },
      });
    } finally {
      setEmbeddingRuntime(null);
    }
  });

  it('stats reports exact T1 provenance coverage from index entries', async () => {
    const { registry } = setup({
      memoryService: () => ({
        harmonicIndex: {
          getIndex: () => ({
            entries: [
              { id: 'a', source_trace_ids: ['t1t_a'], episode_id: 't1ep_a' },
              { id: 'b', source_trace_ids: ['t1t_b', 't1t_c'], episode_id: 't1ep_b' },
              { id: 'c' },
              { id: 'd', source_trace_ids: [] },
            ],
          }),
        },
      }) as any,
      getGatewayDb: () => ({
        count: () => 0,
        archiveCount: () => 0,
        t1RetrievalStats: () => ({ total: 0, byKind: { search: 0, recall: 0, redeem: 0 }, uniqueTraces: 0, lastAt: null }),
        t1ActivationStats: () => ({ traces: 2, mean: 0.15, max: 0.2 }),
      }) as any,
    });
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/memory/stats')!(
      fakeReq({ method: 'GET', url: '/api/memory/stats' }), r.res,
    );
    const body = JSON.parse(r.body);
    expect(body.t1.provenance).toEqual({
      memories: 4,
      withExact: 2,
      coverage: 0.5,
      withEpisode: 2,
      episodeCoverage: 0.5,
    });
    expect(body.t1.cortex).toEqual({
      total: 4,
      active: 4,
      legacyEpisodic: 0,
      superseded: 0,
      exactGrounding: 2,
      hintGrounding: 0,
    });
    expect(body.t1.activation).toEqual({ traces: 2, mean: 0.15, max: 0.2 });
  });

  it('sticky: no memory service → 503 with the empty note-board budget', async () => {
    const { registry } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/memory/sticky')!(
      fakeReq({ method: 'GET', url: '/api/memory/sticky' }), r.res,
    );
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body)).toEqual({ entries: [], budget: emptyNoteBoardBudget() });
  });

  it('DELETE /api/memory/:id is method-locked and decodes the id param', async () => {
    const { registry } = setup();
    // The method dimension is exact: GET on the same shape has no catalog route.
    expect(registry.match('GET' as never, '/api/memory/abc123')).toBeNull();

    const matched = registry.match('DELETE' as never, '/api/memory/ab%2Dc?x=1');
    expect(matched?.def.operationId).toBe('memory.delete');
    expect(matched?.params).toEqual({ id: 'ab-c' });

    // Unknown id → 404 {error:'Not found'} (empty temp store).
    const r = fakeRes();
    await handlerFor(registry, 'DELETE', '/api/memory/abc123')!(
      fakeReq({ method: 'DELETE', url: '/api/memory/abc123' }), r.res,
    );
    expect(r.status).toBe(404);
    expect(JSON.parse(r.body)).toEqual({ error: 'Not found' });
  });
});
