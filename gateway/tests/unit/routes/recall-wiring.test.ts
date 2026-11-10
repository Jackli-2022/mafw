// Phase D1 Task B3: recall thin three registry wiring — 指令块 fallback 委托、
// pinned/priors 的完整 fail-open 空载荷（200，绝不 500）。
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachRecallRoutes } from '../../../src/routes/recall';

function fakeReq(opts: { url: string; method: string; body?: string }): IncomingMessage {
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
  const out = { res: null as unknown as ServerResponse, status: 0, body: '' };
  out.res = {
    writeHead: (status: number) => { out.status = status; },
    end: (payload?: unknown) => { out.body = String(payload ?? ''); },
    setHeader: () => {},
  } as unknown as ServerResponse;
  return out;
}

function setup(opts: { memoryService?: any; blocks?: any; sync?: any } = {}) {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachRecallRoutes(registry, {
    buildInstructionBlocks: async () => opts.blocks ?? {
      revision: 'rev-1',
      memoryGuide: 'GUIDE',
      userProfile: 'PROFILE',
      agentPriors: 'PRIORS',
    },
    instructionSync: () => opts.sync ?? null,
    memoryService: () => opts.memoryService ?? null,
    recallCalledBySession: () => new Map<string, number>(),
    leadSessionRegistry: () => ({ findBySessionId: () => null }) as any,
    registeredProjects: () => new Map(),
    mafwDir: () => '/tmp/mafw-test',
    getGatewayDb: () => ({ kvGet: () => null }) as any,
    getScanService: () => null,
  });
  const handlerFor = (method: string, url: string) => {
    const m = registry.match(method as never, url);
    if (!m?.def.handler) return undefined;
    const handler = m.def.handler;
    return (req: IncomingMessage, res: ServerResponse) => handler(req, res, m.params);
  };
  return { registry, handlerFor };
}

const EMPTY_PINNED = { profile: null, entries: [], budget: { max: 20, maxChars: 2000, used: 0 } };

describe('recall thin three registry wiring (D1 Task B3)', () => {
  it('thin three + context catalog routes have handlers attached', () => {
    const { handlerFor } = setup();
    expect(handlerFor('GET', '/api/recall/instructions')).toBeDefined();
    expect(handlerFor('GET', '/api/recall/pinned')).toBeDefined();
    expect(handlerFor('GET', '/api/recall/priors')).toBeDefined();
    expect(handlerFor('GET', '/api/recall/context')).toBeDefined();
  });

  it('instructions delegates to recall-instructions with unmanaged block payload', async () => {
    const { handlerFor } = setup();
    const r = fakeRes();
    await handlerFor('GET', '/api/recall/instructions?sessionID=s1')!(
      fakeReq({ url: '/api/recall/instructions?sessionID=s1', method: 'GET' }), r.res,
    );
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.managed).toBe(false);
    expect(body.revision).toBe('rev-1');
    // No sync service → every block reported missing and shipped.
    expect(body.missing).toHaveLength(3);
    expect(body.blocks).toEqual({ memoryGuide: 'GUIDE', userProfile: 'PROFILE', agentPriors: 'PRIORS' });
  });

  it('pinned without a memory service returns the FULL empty payload', async () => {
    const { handlerFor } = setup();
    const r = fakeRes();
    await handlerFor('GET', '/api/recall/pinned')!(fakeReq({ url: '/api/recall/pinned', method: 'GET' }), r.res);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual(EMPTY_PINNED);
  });

  it('pinned error keeps status 200 + the same empty payload (fail-open)', async () => {
    const broken = {
      harmonicIndex: { getIndex: () => { throw new Error('index exploded'); } },
    };
    const { handlerFor } = setup({ memoryService: broken });
    const r = fakeRes();
    await handlerFor('GET', '/api/recall/pinned')!(fakeReq({ url: '/api/recall/pinned', method: 'GET' }), r.res);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual(EMPTY_PINNED);
  });

  it('priors always answers 200 with the {block, used, budget.maxChars} envelope', async () => {
    const { handlerFor } = setup();
    const r = fakeRes();
    await handlerFor('GET', '/api/recall/priors')!(fakeReq({ url: '/api/recall/priors', method: 'GET' }), r.res);
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);
    expect(Object.keys(body).sort()).toEqual(['block', 'budget', 'used']);
    expect(body.budget.maxChars).toBe(800);
  });

  // Plan Task 5: /api/recall/context envelope is a hard contract (points at null,
  // never a 500) — pinned by two envelope cases.
  it('context empty-query early-out returns {pointers: null} with status 200', async () => {
    const { handlerFor } = setup();
    const r = fakeRes();
    await handlerFor('GET', '/api/recall/context?sessionID=s1')!(
      fakeReq({ url: '/api/recall/context?sessionID=s1', method: 'GET' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ pointers: null });
  });

  it('context thrown error fails open: status 200 + {pointers: null}', async () => {
    const registry = new RouteRegistry().register(...buildRouteCatalog());
    attachRecallRoutes(registry, {
      buildInstructionBlocks: async () => ({ revision: '', memoryGuide: '', userProfile: '', agentPriors: '' }),
      instructionSync: () => null,
      memoryService: () => null,
      recallCalledBySession: () => new Map<string, number>(),
      // Goal snapshot lookups are NOT inner-guarded (verbatim): a throwing lead
      // registry reaches the outer catch, which must still answer 200.
      leadSessionRegistry: () => ({ findBySessionId: () => { throw new Error('registry exploded'); } }) as any,
      registeredProjects: () => new Map(),
      mafwDir: () => '/tmp/mafw-test',
      getGatewayDb: () => ({ kvGet: () => null }) as any,
      getScanService: () => null,
    });
    const m = registry.match('GET', '/api/recall/context?sessionID=s1&query=hello');
    const r = fakeRes();
    await m!.def.handler!(fakeReq({ url: '/api/recall/context?sessionID=s1&query=hello', method: 'GET' }), r.res, m!.params);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ pointers: null });
  });
});
