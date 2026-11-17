// Phase D1 Task B3: recall thin three registry wiring — 指令块 fallback 委托、
// pinned/priors 的完整 fail-open 空载荷（200，绝不 500）。
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachRecallRoutes } from '../../../src/routes/recall';
import { setTopicState } from '../../../src/recall/topic-state';

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

function setup(opts: { memoryService?: any; blocks?: any; sync?: any; db?: any } = {}) {
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
    getGatewayDb: () => (opts.db ?? { kvGet: () => null }) as any,
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

const flushRequest = () => new Promise<void>((resolve) => setImmediate(resolve));

function topicDb(currentTraceId = 't1t_real') {
  const rows = new Map<string, unknown>();
  return {
    kvGet: (scope: string, key: string) => rows.get(`${scope}\0${key}`) ?? null,
    kvSet: (scope: string, key: string, value: unknown) => rows.set(`${scope}\0${key}`, value),
    currentTurn: (_sessionID: string) => ({ trace_id: currentTraceId, turn_seq: 1 }),
  };
}

describe('recall thin three registry wiring (D1 Task B3)', () => {
  it('serving a T1-only snapshot records recall observations', async () => {
    const recorded: any[] = [];
    const now = new Date().toISOString();
    const { handlerFor } = setup({
      db: {
        kvGet: () => ({
          query: 'hello',
          block: 'T1-only block',
          ids: [],
          builtAt: now,
          t1Hits: [{ sessionId: 's1', turnId: 1, traceId: 't1t_a', cosine: 0.81, excerpt: 'raw' }],
        }),
        recordT1RetrievalEvent: (e: any) => recorded.push(e),
      },
    });
    const r = fakeRes();
    await handlerFor('GET', '/api/recall/context?sessionID=s1&query=hello')!(
      fakeReq({ url: '/api/recall/context?sessionID=s1&query=hello', method: 'GET' }), r.res,
    );
    expect(r.status).toBe(200);
    const pointers = JSON.parse(r.body).pointers;
    expect(pointers).toBe(
      '<topic-recall>\n主题：未设置\n相关记忆：见下方\n' +
      'Agent：理解当前对话后，使用 mafw_topic_set 设置主题\n</topic-recall>\n\n' +
      'T1-only block',
    );
    expect(recorded).toEqual([{ traceId: 't1t_a', kind: 'recall', score: 0.81 }]);
  });

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

  // Review fix wave: the recall.instructions handler must RETURN the delegate's
  // boolean. `dispatchAuthorized` treats `undefined` as handled, so `if (handled)
  // return;` silently swallowed the delegate's false (fall-through contract) and the
  // request hung with no response. Delegates that decline (non-GET here) must yield
  // handled=false + zero bytes written.
  it('instructions returns the delegate boolean: declining delegate → false, no response', async () => {
    const { handlerFor } = setup();
    const r = fakeRes();
    const handled = await handlerFor('GET', '/api/recall/instructions')!(
      // Registry dispatches GET, but the delegate itself re-checks the method and
      // declines anything else — that decline must reach dispatchAuthorized.
      fakeReq({ url: '/api/recall/instructions', method: 'POST' }), r.res,
    );
    expect(handled).toBe(false);
    expect(r.status).toBe(0);
    expect(r.body).toBe('');
  });

  it('instructions returns the delegate boolean: handled path → true', async () => {
    const { handlerFor } = setup();
    const r = fakeRes();
    const handled = await handlerFor('GET', '/api/recall/instructions')!(
      fakeReq({ url: '/api/recall/instructions', method: 'GET' }), r.res,
    );
    expect(handled).toBe(true);
    expect(r.status).toBe(200);
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
  it('context empty-query early-out still reports the topic header', async () => {
    const { handlerFor } = setup();
    const r = fakeRes();
    await handlerFor('GET', '/api/recall/context?sessionID=s1')!(
      fakeReq({ url: '/api/recall/context?sessionID=s1', method: 'GET' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).pointers).toContain('主题：未设置');
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

  it('context reports the active topic with no related memory when retrieval is empty', async () => {
    const db = topicDb();
    setTopicState(db, { sessionID: 's1', topic: '个人 Agent 记忆' });
    const { handlerFor } = setup({ db });
    const r = fakeRes();
    await handlerFor('GET', '/api/recall/context?sessionID=s1&query=hello')!(
      fakeReq({ url: '/api/recall/context?sessionID=s1&query=hello', method: 'GET' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).pointers).toBe(
      '<topic-recall>\n主题：个人 Agent 记忆\n相关记忆：无\n</topic-recall>',
    );
  });

  it('topic route requires sessionID', async () => {
    const { handlerFor } = setup({ db: topicDb() });
    const r = fakeRes();
    await handlerFor('POST', '/api/recall/topic')!(
      fakeReq({ url: '/api/recall/topic', method: 'POST', body: JSON.stringify({ topic: 'x' }) }),
      r.res,
    );
    await flushRequest();
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body)).toMatchObject({ ok: false });
  });

  it('topic route rejects a non-boolean active instead of publishing an invalid state', async () => {
    const db = topicDb();
    const { handlerFor } = setup({ db });
    const r = fakeRes();
    await handlerFor('POST', '/api/recall/topic')!(
      fakeReq({
        url: '/api/recall/topic',
        method: 'POST',
        body: JSON.stringify({ sessionID: 's1', topic: '主题', active: 'false' }),
      }),
      r.res,
    );
    await flushRequest();
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body)).toMatchObject({ ok: false });
  });

  it('topic route sets and updates a per-session state with the real trace', async () => {
    const db = topicDb();
    const { handlerFor } = setup({ db });
    const first = fakeRes();
    await handlerFor('POST', '/api/recall/topic')!(
      fakeReq({
        url: '/api/recall/topic',
        method: 'POST',
        body: JSON.stringify({ sessionID: 's1', topic: '主题 A', sourceTraceId: 't1t_forged' }),
      }),
      first.res,
    );
    await flushRequest();
    expect(first.status).toBe(200);
    expect(JSON.parse(first.body)).toMatchObject({
      ok: true,
      state: { sessionId: 's1', topic: '主题 A', revision: 1, sourceTraceId: 't1t_real' },
    });

    const second = fakeRes();
    await handlerFor('POST', '/api/recall/topic')!(
      fakeReq({
        url: '/api/recall/topic',
        method: 'POST',
        body: JSON.stringify({ sessionID: 's1', topic: '主题 B', expectedRevision: 1 }),
      }),
      second.res,
    );
    await flushRequest();
    expect(JSON.parse(second.body)).toMatchObject({ ok: true, state: { topic: '主题 B', revision: 2 } });
  });

  it('topic route reports a revision conflict as 409', async () => {
    const db = topicDb();
    const { handlerFor } = setup({ db });
    await handlerFor('POST', '/api/recall/topic')!(
      fakeReq({ url: '/api/recall/topic', method: 'POST', body: JSON.stringify({ sessionID: 's1', topic: 'A' }) }),
      fakeRes().res,
    );
    await flushRequest();
    const conflict = fakeRes();
    await handlerFor('POST', '/api/recall/topic')!(
      fakeReq({
        url: '/api/recall/topic',
        method: 'POST',
        body: JSON.stringify({ sessionID: 's1', topic: 'B', expectedRevision: 0 }),
      }),
      conflict.res,
    );
    await flushRequest();
    expect(conflict.status).toBe(409);
    expect(JSON.parse(conflict.body)).toMatchObject({ ok: false, code: 'topic_revision_conflict' });
  });
});
