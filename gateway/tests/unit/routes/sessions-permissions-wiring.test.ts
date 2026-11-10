// Phase D1 Task E2: sessions 审批 / 子代理 registry wiring — seven legacy branches
// (permission-mode GET+POST share one legacy const; permissions reply delegates to
// routes/permission.ts with the permissionList findRequest closure; five subagent
// ops delegate to routes/subagents.ts). The five subagent paths are NEW catalog
// entries (NON_SDK + internal); the catalog method dimension replaces the legacy
// shared-matcher method arms.
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachSessionsPermissionsRoutes } from '../../../src/routes/sessions-permissions';
import { AUTO_APPROVE_BUDGET } from '../../../src/core/approval/policy-service';

function fakeReq(opts: { url: string; method: string; body?: string }): IncomingMessage {
  const listeners: Record<string, Array<(c?: unknown) => void>> = {};
  const req: any = {
    method: opts.method,
    url: opts.url,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
    on(ev: string, fn: (c?: unknown) => void) {
      (listeners[ev] = listeners[ev] || []).push(fn);
      return req;
    },
    async *[Symbol.asyncIterator]() {
      if (opts.body !== undefined) yield Buffer.from(opts.body);
    },
  };
  process.nextTick(() => {
    for (const fn of listeners['data'] ?? []) fn(opts.body ?? '');
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req as IncomingMessage;
}

function fakeRes(): { res: ServerResponse; status: number; body: string; headers: any } {
  const out = { res: null as unknown as ServerResponse, status: 200, body: '', headers: {} as any };
  out.res = {
    writeHead: (status: number, headers?: any) => { out.status = status; if (headers) out.headers = headers; },
    end: (payload?: unknown) => { out.body = String(payload ?? ''); },
    setHeader: () => {},
  } as unknown as ServerResponse;
  return out;
}

interface SetupOpts {
  mode?: string;
  runtime?: any;
  addCalls?: any[];
}

function setup(opts: SetupOpts = {}) {
  const calls: string[] = [];
  const setModes: Array<[string, string]> = [];
  const added: any[] = opts.addCalls ?? [];

  const policy = {
    getMode: async (sid: string) => { calls.push(`getMode:${sid}`); return opts.mode ?? 'manual'; },
    setMode: async (sid: string, mode: string) => { calls.push(`setMode:${sid}`); setModes.push([sid, mode]); },
    getAutoApprovals: (sid: string) => { calls.push(`autoApprovals:${sid}`); return 2; },
  };

  const service = {
    spawn: async (o: any) => { calls.push(`spawn:${o.parentID}:${o.agent}`); return { id: 'c1', status: 'running' }; },
    list: async (parentID: string) => { calls.push(`list:${parentID}`); return [{ id: 'c1' }]; },
    message: async (parentID: string, childID: string, text: string) => { calls.push(`message:${parentID}:${childID}:${text}`); },
    cancel: async (parentID: string, childID: string) => { calls.push(`cancel:${parentID}:${childID}`); },
    result: async (parentID: string, childID: string) => { calls.push(`result:${parentID}:${childID}`); return { status: 'completed' }; },
  };

  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachSessionsPermissionsRoutes(registry, {
    approvalPolicy: () => policy,
    runtime: () => opts.runtime ?? null,
    permissionRules: () => ({ add: (rule: any) => { added.push(rule); return { ok: true }; } }),
    subagentService: () => service,
  });

  return { registry, calls, setModes, added };
}

const handlerFor = (registry: RouteRegistry, method: string, url: string) => {
  const m = registry.match(method as never, url);
  if (!m?.def.handler) return undefined;
  const handler = m.def.handler;
  return (req: IncomingMessage, res: ServerResponse) => handler(req, res, m.params);
};

describe('sessions permissions/subagents registry wiring (D1 Task E2)', () => {
  it('all eight catalog routes have handlers attached (no silent 404)', () => {
    const { registry } = setup();
    const expectOps: Array<[string, string, string]> = [
      ['GET', '/api/sessions/s1/permission-mode', 'permissions.getMode'],
      ['POST', '/api/sessions/s1/permission-mode', 'permissions.setMode'],
      ['POST', '/api/sessions/s1/permissions/r1', 'permissions.replyRuntime'],
      ['POST', '/api/sessions/s1/subagents', 'session.subagents.spawn'],
      ['GET', '/api/sessions/s1/subagents', 'session.subagents.list'],
      ['POST', '/api/sessions/s1/subagents/c1/message', 'session.subagents.message'],
      ['POST', '/api/sessions/s1/subagents/c1/cancel', 'session.subagents.cancel'],
      ['GET', '/api/sessions/s1/subagents/c1/result', 'session.subagents.result'],
    ];
    for (const [method, url, op] of expectOps) {
      expect(registry.match(method as never, url)?.def.operationId).toBe(op);
      expect(handlerFor(registry, method, url)).toBeDefined();
    }
    // New subagent entries are internal (not in the SDK call surface).
    for (const [method, url] of expectOps.slice(3)) {
      expect(registry.match(method as never, url)?.def.tags).toEqual(['internal']);
    }
  });

  it('permission-mode GET/POST method split (legacy shared const decomposed)', async () => {
    const { registry, calls, setModes } = setup({ mode: 'auto' });
    let r = fakeRes();
    await handlerFor(registry, 'GET', '/api/sessions/s1/permission-mode')!(
      fakeReq({ url: '/api/sessions/s1/permission-mode', method: 'GET' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ mode: 'auto', autoApprovals: 2, budget: AUTO_APPROVE_BUDGET });
    expect(calls).toEqual(['getMode:s1', 'autoApprovals:s1']);

    r = fakeRes();
    await handlerFor(registry, 'POST', '/api/sessions/s1/permission-mode')!(
      fakeReq({ url: '/api/sessions/s1/permission-mode', method: 'POST', body: JSON.stringify({ mode: 'full-access' }) }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ mode: 'full-access', autoApprovals: 0, budget: AUTO_APPROVE_BUDGET });
    expect(setModes).toEqual([['s1', 'full-access']]);
  });

  it('permission-mode POST rejects an unknown mode with 400 (delegate validation intact)', async () => {
    const { registry, setModes } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/sessions/s1/permission-mode')!(
      fakeReq({ url: '/api/sessions/s1/permission-mode', method: 'POST', body: JSON.stringify({ mode: 'yolo' }) }), r.res,
    );
    expect(r.status).toBe(400);
    expect(setModes).toEqual([]);
  });

  it('permissions reply delegates with the runtime, access gate and findRequest closure', async () => {
    const runtime = {
      access: { can: (id: string) => id === 'approval.permissionReply' },
      session: {
        permissionReply: async (sid: string, rid: string, reply: string) => {
          expect([sid, rid, reply]).toEqual(['s1', 'r1', 'always']);
          return true;
        },
        permissionList: async () => [{ id: 'r1', permission: 'bash', patterns: ['git *'] }],
      },
    };
    const { registry, added } = setup({ runtime });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/sessions/s1/permissions/r1')!(
      fakeReq({ url: '/api/sessions/s1/permissions/r1', method: 'POST', body: JSON.stringify({ reply: 'always' }) }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ success: true });
    // findRequest found the pending request and 'always' persisted its rule.
    expect(added).toEqual([{ tool: 'bash', pattern: 'git', action: 'allow' }]);
  });

  it('permissions reply is a neutral 503 without the runtime surface', async () => {
    const { registry } = setup({ runtime: { access: { can: () => false }, session: {} } });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/sessions/s1/permissions/r1')!(
      fakeReq({ url: '/api/sessions/s1/permissions/r1', method: 'POST', body: JSON.stringify({ reply: 'once' }) }), r.res,
    );
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body).error).toBe('runtime does not support approval.permissionReply');
  });

  it('subagent spawn/list/message/cancel/result all delegate to the service', async () => {
    const { registry, calls } = setup();

    let r = fakeRes();
    await handlerFor(registry, 'POST', '/api/sessions/p1/subagents')!(
      fakeReq({ url: '/api/sessions/p1/subagents', method: 'POST', body: JSON.stringify({ prompt: 'go', agent: 'general' }) }), r.res,
    );
    expect(JSON.parse(r.body)).toEqual({ id: 'c1', status: 'running' });

    r = fakeRes();
    await handlerFor(registry, 'GET', '/api/sessions/p1/subagents')!(
      fakeReq({ url: '/api/sessions/p1/subagents', method: 'GET' }), r.res,
    );
    expect(JSON.parse(r.body)).toEqual({ items: [{ id: 'c1' }] });

    r = fakeRes();
    await handlerFor(registry, 'POST', '/api/sessions/p1/subagents/c1/message')!(
      fakeReq({ url: '/api/sessions/p1/subagents/c1/message', method: 'POST', body: JSON.stringify({ message: 'hi' }) }), r.res,
    );
    expect(JSON.parse(r.body)).toEqual({ ok: true });

    r = fakeRes();
    await handlerFor(registry, 'POST', '/api/sessions/p1/subagents/c1/cancel')!(
      fakeReq({ url: '/api/sessions/p1/subagents/c1/cancel', method: 'POST', body: '{}' }), r.res,
    );
    expect(JSON.parse(r.body)).toEqual({ ok: true });

    r = fakeRes();
    await handlerFor(registry, 'GET', '/api/sessions/p1/subagents/c1/result')!(
      fakeReq({ url: '/api/sessions/p1/subagents/c1/result', method: 'GET' }), r.res,
    );
    expect(JSON.parse(r.body)).toEqual({ status: 'completed' });

    expect(calls).toEqual([
      'spawn:p1:general',
      'list:p1',
      'message:p1:c1:hi',
      'cancel:p1:c1',
      'result:p1:c1',
    ]);
  });

  it('subagent spawn surfaces a failed record as 502 (delegate status mapping intact)', async () => {
    const svc = { spawn: async () => ({ id: 'c1', status: 'failed' }) };
    const other = new RouteRegistry().register(...buildRouteCatalog());
    attachSessionsPermissionsRoutes(other, {
      approvalPolicy: () => ({ getMode: async () => 'manual', setMode: async () => {}, getAutoApprovals: () => 0 }),
      runtime: () => null,
      permissionRules: () => ({ add: () => ({ ok: true }) }),
      subagentService: () => svc as any,
    });
    const r = fakeRes();
    await handlerFor(other, 'POST', '/api/sessions/p1/subagents')!(
      fakeReq({ url: '/api/sessions/p1/subagents', method: 'POST', body: JSON.stringify({ prompt: 'go' }) }), r.res,
    );
    expect(r.status).toBe(502);
  });
});
