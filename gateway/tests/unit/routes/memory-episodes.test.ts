import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachMemoryRoutes } from '../../../src/routes/memory';
import { config } from '../../../src/config';
import type { EpisodeHit } from '../../../src/recall/t1-episode-search';
import type { T1EpisodeRecord } from '../../../src/recall/t1-episodes';

function fakeReq(url: string): IncomingMessage {
  return {
    method: 'GET',
    url,
    headers: {},
  } as unknown as IncomingMessage;
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

const handlerFor = (registry: RouteRegistry, method: string, url: string) => {
  const m = registry.match(method as never, url);
  if (!m?.def.handler) return undefined;
  return (req: IncomingMessage, res: ServerResponse) => m.def.handler!(req, res, m.params);
};

const sampleEpisode: T1EpisodeRecord = {
  episodeId: 't1ep_a',
  sessionId: 's1',
  startTurn: 1,
  endTurn: 3,
  status: 'closed',
  startedAt: 1000,
  endedAt: 2000,
  boundarySource: 'declared',
  boundaryReason: 'agent_declared',
  confidence: 1,
  intent: 'review embedding',
  actors: [{ actorId: 'agent:reviewer', role: 'reviewer', weight: 1 }],
  conceptIds: ['concept:embedding'],
  sourceTraceIds: ['t1t_1', 't1t_2'],
};

const episodeHit: EpisodeHit = {
  episodeId: 't1ep_a',
  sessionId: 's1',
  startTurn: 1,
  endTurn: 3,
  status: 'closed',
  startedAt: 1000,
  boundarySource: 'declared',
  intent: 'review embedding',
  actors: ['agent:reviewer'],
  conceptIds: ['concept:embedding'],
  score: 1,
  sources: ['turn', 'declared'],
  topTraceIds: ['t1t_1'],
};

function setup(opts: { episodes?: EpisodeHit[] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-episodes-route-'));
  const calls = { list: 0, episode: 0, search: 0 };
  const db = {
    listEpisodes: (o: any) => {
      calls.list++;
      return { episodes: [sampleEpisode], nextCursor: 'next' };
    },
    getEpisode: (id: string) => {
      calls.episode++;
      return id === sampleEpisode.episodeId ? sampleEpisode : null;
    },
    listEpisodeMembers: () => [
      { episodeId: sampleEpisode.episodeId, traceId: 't1t_1', turnSeq: 1 },
    ],
  } as any;
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachMemoryRoutes(registry, {
    memoryService: () => ({
      harmonicIndex: {
        getIndex: () => ({ entries: [] }),
        searchScored: () => [],
        search: () => [],
      },
    }) as any,
    consolidationService: () => null,
    heartbeat: () => null,
    coactivationGraphStore: () => null,
    fokStatsCache: () => null,
    setFokStatsCache: () => {},
    mafwDir: () => dir,
    getGatewayDb: () => db,
    backfillEmbeddings: async () => ({}),
    searchEpisodes: async () => {
      calls.search++;
      return opts.episodes ?? [episodeHit];
    },
  } as any);
  return { registry, dir, calls };
}

describe('memory episode routes', () => {
  test('layer=episodes returns episodes without knowledge', async () => {
    const { registry, dir } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/memory/search')!(fakeReq('/api/memory/search?query=embedding&layer=episodes'), r.res);
    const body = JSON.parse(r.body);
    expect(body.results).toEqual([]);
    expect(body.t1Results).toEqual([]);
    expect(body.episodes[0]).toMatchObject({ episodeId: 't1ep_a', score: 1 });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('layer=auto in shadow returns an empty episode section', async () => {
    const previous = config.recall.t1Episodes.mode;
    config.recall.t1Episodes.mode = 'shadow';
    const { registry, dir, calls } = setup();
    try {
      const r = fakeRes();
      await handlerFor(registry, 'GET', '/api/memory/search')!(fakeReq('/api/memory/search?query=embedding&layer=auto'), r.res);
      const body = JSON.parse(r.body);
      expect(body.episodes).toEqual([]);
      expect(calls.search).toBe(0);
    } finally {
      config.recall.t1Episodes.mode = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('layer=auto in live includes episodes', async () => {
    const previous = config.recall.t1Episodes.mode;
    config.recall.t1Episodes.mode = 'live';
    const { registry, dir } = setup();
    try {
      const r = fakeRes();
      await handlerFor(registry, 'GET', '/api/memory/search')!(fakeReq('/api/memory/search?query=embedding&layer=auto'), r.res);
      expect(JSON.parse(r.body).episodes[0].episodeId).toBe('t1ep_a');
    } finally {
      config.recall.t1Episodes.mode = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('GET /api/memory/episodes lists recent episodes with cursor', async () => {
    const { registry, dir, calls } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/memory/episodes')!(fakeReq('/api/memory/episodes?limit=2&sessionId=s1'), r.res);
    const body = JSON.parse(r.body);
    expect(calls.list).toBe(1);
    expect(body.nextCursor).toBe('next');
    expect(body.episodes[0]).toMatchObject({ episodeId: 't1ep_a', topTraceIds: ['t1t_1', 't1t_2'] });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('GET /api/memory/episodes/:id returns episode + members, 404 unknown', async () => {
    const { registry, dir } = setup();
    let r = fakeRes();
    await handlerFor(registry, 'GET', '/api/memory/episodes/t1ep_a')!(fakeReq('/api/memory/episodes/t1ep_a'), r.res);
    expect(JSON.parse(r.body)).toMatchObject({
      episode: { episodeId: 't1ep_a' },
      members: [{ traceId: 't1t_1', turnSeq: 1 }],
    });
    r = fakeRes();
    await handlerFor(registry, 'GET', '/api/memory/episodes/missing')!(fakeReq('/api/memory/episodes/missing'), r.res);
    expect(r.status).toBe(404);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
