// Phase D1 Task B1: questions/permissions registry wiring — capGuard 门、workspace
// 重试链顺序、permissions.reply 委托（列表反查 sessionID）保留。
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachQuestionsPermissionsRoutes } from '../../../src/routes/questions-permissions';

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
  const out = { res: null as unknown as ServerResponse, status: 200, body: '' };
  out.res = {
    writeHead: (status: number) => { out.status = status; },
    end: (payload?: unknown) => { out.body = String(payload ?? ''); },
    setHeader: () => {},
  } as unknown as ServerResponse;
  return out;
}

interface SetupOpts {
  questionGate?: boolean;
  permissionGate?: boolean;
  question?: any;
  runtime?: any;
  projects?: string[];
}

function setup(opts: SetupOpts = {}) {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachQuestionsPermissionsRoutes(registry, {
    capGuard: (res, surface) => {
      if (!opts.permissionGate) return false;
      res.writeHead(503);
      res.end(JSON.stringify({ error: `runtime surface '${surface}' is not available` }));
      return true;
    },
    capGuardQuestion: (res) => {
      if (!opts.questionGate) return false;
      res.writeHead(503);
      res.end(JSON.stringify({ error: "runtime surface 'approval.question.list' is not available" }));
      return true;
    },
    serveUrl: () => 'http://127.0.0.1:3000',
    currentProjectDir: () => null,
    projectDir: () => '/proj/main',
    runtime: () => opts.runtime ?? null,
    registeredProjects: () => new Map((opts.projects ?? []).map((p) => [p, {}])),
    permissionRules: () => undefined,
  });
  const handlerFor = (method: string, url: string) => {
    const m = registry.match(method as never, url);
    if (!m?.def.handler) return undefined;
    const handler = m.def.handler;
    return (req: IncomingMessage, res: ServerResponse) => handler(req, res, m.params);
  };
  return { registry, handlerFor };
}

describe('questions/permissions registry wiring (D1 Task B1)', () => {
  it('all catalog routes have handlers attached (no silent 404)', () => {
    const { handlerFor } = setup();
    expect(handlerFor('GET', '/api/questions')).toBeDefined();
    expect(handlerFor('POST', '/api/questions/q1/reply')).toBeDefined();
    expect(handlerFor('POST', '/api/questions/q1/reject')).toBeDefined();
    expect(handlerFor('GET', '/api/permissions')).toBeDefined();
    expect(handlerFor('POST', '/api/permissions/r1/reply')).toBeDefined();
  });

  it('questions.list gates first, then projects runtime items', async () => {
    const gated = setup({ questionGate: true });
    let r = fakeRes();
    await gated.handlerFor('GET', '/api/questions')!(fakeReq({ url: '/api/questions', method: 'GET' }), r.res);
    expect(r.status).toBe(503);

    const question = { list: async () => [{ id: 'q1', sessionID: 's1', questions: [{ question: 'Q?' }] }] };
    const { handlerFor } = setup({ question: question as any, runtime: { session: { question } } as any });
    r = fakeRes();
    await handlerFor('GET', '/api/questions')!(fakeReq({ url: '/api/questions', method: 'GET' }), r.res);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).items).toHaveLength(1);
  });

  it('questions.reply retries every workspace and succeeds on a later one', async () => {
    const tried: Array<string | undefined> = [];
    const question = {
      reply: async (args: any) => {
        tried.push(args.directory);
        if (args.directory !== '/proj/other') throw new Error('wrong workspace');
        return true;
      },
    };
    const { handlerFor } = setup({ question, runtime: { session: { question } } as any, projects: ['/proj/other'] });
    const r = fakeRes();
    await handlerFor('POST', '/api/questions/q1/reply')!(
      fakeReq({ url: '/api/questions/q1/reply', method: 'POST', body: JSON.stringify({ answers: [['a']] }) }), r.res,
    );
    expect(JSON.parse(r.body)).toEqual({ status: 'ok' });
    // undefined (runtime default) → projectDir → registered project
    expect(tried).toEqual([undefined, '/proj/main', '/proj/other']);
  });

  it('questions.reject reports the last workspace error when all fail', async () => {
    const question = { reject: async (args: any) => { throw new Error(`fail ${args.directory ?? 'default'}`); } };
    const { handlerFor } = setup({ question, runtime: { session: { question } } as any });
    const r = fakeRes();
    await handlerFor('POST', '/api/questions/q1/reject')!(
      fakeReq({ url: '/api/questions/q1/reject', method: 'POST' }), r.res,
    );
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body)).toEqual({ status: 'error', error: 'fail /proj/main' });
  });

  it('questions.reply 503s when the runtime has no question channel', async () => {
    const { handlerFor } = setup({ runtime: { session: {} } as any });
    const r = fakeRes();
    await handlerFor('POST', '/api/questions/q1/reply')!(
      fakeReq({ url: '/api/questions/q1/reply', method: 'POST', body: '{}' }), r.res,
    );
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body).error).toBe('question API not available on this runtime');
  });

  it('permissions.list gated → 503; ungated projects runtime items', async () => {
    const gated = setup({ permissionGate: true });
    let r = fakeRes();
    await gated.handlerFor('GET', '/api/permissions')!(fakeReq({ url: '/api/permissions', method: 'GET' }), r.res);
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body).error).toContain('approval.permissionList');

    const permissionList = async () => [{ id: 'p1', sessionID: 's1', permission: 'bash', patterns: [] }];
    const { handlerFor } = setup({ runtime: { session: { permissionList } } as any });
    r = fakeRes();
    await handlerFor('GET', '/api/permissions')!(fakeReq({ url: '/api/permissions', method: 'GET' }), r.res);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).items).toHaveLength(1);
  });

  it('permissions.reply resolves sessionID from the pending list and replies', async () => {
    const replied: any[] = [];
    const runtime = {
      access: { can: () => true },
      session: {
        permissionList: async () => [{ id: 'r1', sessionID: 's1' }],
        permissionReply: async (...args: any[]) => { replied.push(args); return true; },
      },
    };
    const { handlerFor } = setup({ runtime: runtime as any });
    const r = fakeRes();
    await handlerFor('POST', '/api/permissions/r1/reply')!(
      fakeReq({ url: '/api/permissions/r1/reply', method: 'POST', body: JSON.stringify({ reply: 'once' }) }), r.res,
    );
    expect(JSON.parse(r.body)).toEqual({ status: 'ok' });
    expect(replied[0][0]).toBe('s1');
    expect(replied[0][1]).toBe('r1');
    expect(replied[0][2]).toBe('once');
  });
});
