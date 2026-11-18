import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachRecallRoutes } from '../../../src/routes/recall';
import { config } from '../../../src/config';

function fakeReq(url: string): IncomingMessage {
  return {
    method: 'GET',
    url,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
    on() { return this; },
  } as unknown as IncomingMessage;
}

function fakeRes() {
  const out = { res: null as unknown as ServerResponse, status: 0, body: '' };
  out.res = {
    writeHead: (status: number) => { out.status = status; },
    end: (payload?: unknown) => { out.body = String(payload ?? ''); },
    setHeader: () => {},
    destroyed: false,
  } as unknown as ServerResponse;
  return out;
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function snapshot() {
  return {
    query: 'hello',
    block: '<recall>hello</recall>',
    ids: ['mem_a'],
    builtAt: new Date().toISOString(),
    fokStatus: 'inject',
    top1prob: 0.9,
    memories: [{
      id: 'mem_a',
      type: 'semantic',
      abstraction: '用户偏好 TDD',
      date: '2026-10-01T00:00:00.000Z',
      energy: 0.8,
    }],
    t1Hits: [
      { sessionId: 's1', turnId: 1, traceId: 't1t_a', cosine: 0.9, excerpt: '元信息怎么展示', source: 'user' },
      { sessionId: 's1', turnId: 2, traceId: 't1t_b', cosine: 0.7, excerpt: 'ok | packages\\desktop', source: 'tool' },
    ],
    t1Rendered: true,
  };
}

function setup(deps: Record<string, unknown> = {}) {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachRecallRoutes(registry, {
    buildInstructionBlocks: async () => ({ revision: 'r', memoryGuide: '', userProfile: '', agentPriors: '' }),
    instructionSync: () => null,
    memoryService: () => null,
    recallCalledBySession: () => new Map<string, number>(),
    leadSessionRegistry: () => ({ findBySessionId: () => null }) as any,
    registeredProjects: () => new Map(),
    mafwDir: () => '/tmp/mafw-test',
    getGatewayDb: () => ({
      kvGet: (scope: string, key: string) => {
        if (scope === 'recall-snapshot' && key === 's1') return snapshot();
        return null;
      },
    }) as any,
    getScanService: () => null,
    ...(deps as any),
  });
  return async (url = '/api/recall/context?sessionID=s1&query=hello&anchorKey=turn_a', res?: ServerResponse) => {
    const m = registry.match('GET' as never, url)!;
    const r = res ? { res, status: 0, body: '' } : fakeRes();
    await (m.def.handler as any)(fakeReq(url), r.res, m.params);
    return r;
  };
}

describe('recall receipt route', () => {
  let enabled = false;
  beforeEach(() => {
    enabled = config.search.snapshot.enabled;
    config.search.snapshot.enabled = true;
    delete process.env.MAFW_MEMORY_RECEIPT;
  });
  afterEach(() => {
    config.search.snapshot.enabled = enabled;
    delete process.env.MAFW_MEMORY_RECEIPT;
  });

  it('emits a structured receipt after the response ends', async () => {
    const events: string[] = [];
    const broadcasts: any[] = [];
    const saves: any[] = [];
    const run = setup({
      broadcast: (event: any) => { events.push('broadcast'); broadcasts.push(event); },
      saveReceipt: (input: any) => { events.push('save'); saves.push(input); },
    });
    const r = fakeRes();
    const end = r.res.end.bind(r.res);
    (r.res as any).end = (payload?: unknown) => { events.push('end'); end(payload); };

    await run(undefined, r.res);
    await flush();

    expect(r.status).toBe(200);
    expect(events[0]).toBe('end');
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].type).toBe('memory.recalled');
    expect(broadcasts[0].properties.anchorKey).toBe('turn_a');
    expect(broadcasts[0].properties.receipt.counts).toEqual({ memories: 1, t1: 1 });
    expect(broadcasts[0].properties.receipt.filteredT1).toBe(1);
    expect(saves).toHaveLength(1);
    expect(JSON.stringify(broadcasts[0])).not.toContain('memory_value');
  });

  it('does not emit without anchorKey', async () => {
    const broadcasts: any[] = [];
    const run = setup({ broadcast: (e: any) => broadcasts.push(e), saveReceipt: () => {} });
    await run('/api/recall/context?sessionID=s1&query=hello');
    await flush();
    expect(broadcasts).toHaveLength(0);
  });

  it('does not emit when the client aborted', async () => {
    const broadcasts: any[] = [];
    const run = setup({ broadcast: (e: any) => broadcasts.push(e), saveReceipt: () => {} });
    const r = fakeRes();
    (r.res as any).destroyed = true;
    await run(undefined, r.res);
    await flush();
    expect(broadcasts).toHaveLength(0);
  });

  it('is disabled by MAFW_MEMORY_RECEIPT=0', async () => {
    process.env.MAFW_MEMORY_RECEIPT = '0';
    const broadcasts: any[] = [];
    const run = setup({ broadcast: (e: any) => broadcasts.push(e), saveReceipt: () => {} });
    await run();
    await flush();
    expect(broadcasts).toHaveLength(0);
  });

  it('stays 200 when the receipt store throws', async () => {
    const run = setup({
      broadcast: () => {},
      saveReceipt: () => { throw new Error('db busy'); },
    });
    const r = await run();
    await flush();
    expect(r.status).toBe(200);
  });

  it('does not await the receipt store', async () => {
    let release: (() => void) | undefined;
    const never = new Promise<void>((resolve) => { release = resolve; });
    const run = setup({ broadcast: () => {}, saveReceipt: () => never });
    const r = await run();
    expect(r.status).toBe(200);
    release?.();
    await flush();
  });
});
