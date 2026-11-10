// Phase D1 Task H1: long-tail singles wiring — voice.status / presence.get /
// eval.chatCompletions / orchestration.outcomes / providers.list / agents.list.
// Bodies are verbatim moves; these tests pin the parts that used to live in
// index.ts: delegation deps, status/body pass-through, the eval 400 arm, the
// capGuard ordering, and the query parse for outcomes.
const mockHandleEvalChatCompletion = jest.fn();
const mockEvalHandler = jest.fn();

jest.mock('../../../src/eval-endpoint', () => ({
  handleEvalChatCompletion: (opts: unknown) => {
    mockHandleEvalChatCompletion(opts);
    return mockEvalHandler;
  },
}));

import type { IncomingMessage, ServerResponse } from 'http';
import { log } from '../../../src/core/utils/logger';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachMiscRoutes, type MiscRouteDeps } from '../../../src/routes/misc';

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

function fakeRes(): { res: ServerResponse; status: number; body: string; headers: Record<string, unknown> } {
  const out = { res: null as unknown as ServerResponse, status: 200, body: '', headers: {} as Record<string, unknown> };
  out.res = {
    writeHead: (status: number, headers?: Record<string, unknown>) => {
      out.status = status;
      if (headers) Object.assign(out.headers, headers);
    },
    end: (payload?: unknown) => { out.body = String(payload ?? ''); },
    setHeader: (key: string, value: unknown) => { out.headers[key] = value; },
  } as unknown as ServerResponse;
  return { res: out.res, get status() { return out.status; }, get body() { return out.body; }, get headers() { return out.headers; } } as any;
}

function setup(over: Partial<MiscRouteDeps> = {}) {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  const deps: MiscRouteDeps = {
    voiceRuntime: () => undefined,
    buildPresence: () => ({ projects: [] } as any),
    runtime: () => null,
    resolvedProjectDir: () => 'C:/proj',
    getGatewayDb: () => ({ listGoalOutcomes: () => [] } as any),
    capGuard: () => false,
    identityRegistry: () => ({ list: () => [] }),
    identityState: () => ({ isMaterialized: () => true }),
    runtimeName: () => 'opencode',
    ...over,
  };
  attachMiscRoutes(registry, deps);
  return { registry, deps };
}

const handlerFor = (registry: RouteRegistry, method: string, url: string) => {
  const m = registry.match(method as never, url);
  if (!m?.def.handler) return undefined;
  const handler = m.def.handler;
  return (req: IncomingMessage, res: ServerResponse) => handler(req, res, m.params);
};

beforeEach(() => {
  mockHandleEvalChatCompletion.mockReset();
  mockEvalHandler.mockReset();
});

describe('long-tail singles registry wiring (D1 Task H1)', () => {
  it('binds the six shadow entries to their catalog operationIds', () => {
    const { registry } = setup();
    const expectOps: Array<[string, string, string]> = [
      ['GET', '/api/voice/status', 'voice.status'],
      ['GET', '/api/presence', 'presence.get'],
      ['POST', '/api/eval/chat/completions', 'eval.chatCompletions'],
      ['GET', '/api/orchestration/outcomes', 'orchestration.outcomes'],
      ['GET', '/api/provider', 'providers.list'],
      ['GET', '/api/agents', 'agents.list'],
    ];
    for (const [method, url, op] of expectOps) {
      expect(registry.match(method as never, url)?.def.operationId).toBe(op);
      expect(handlerFor(registry, method, url)).toBeDefined();
    }
  });

  it('voice.status delegates the live runtime + resolved voice config', async () => {
    const status = jest.fn(() => ({ engines: [{ id: 'asr' }], routing: { asr: 'local' } }));
    const voiceRuntime = { status } as any;
    const { registry } = setup({ voiceRuntime: () => voiceRuntime });
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/voice/status')!(fakeReq({ method: 'GET', url: '/api/voice/status' }), r.res);
    expect(status).toHaveBeenCalled();
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ ok: true, engines: [{ id: 'asr' }], routing: { asr: 'local' } });
    expect(JSON.parse(r.body).config).toBeDefined();
  });

  it('voice.status tolerates an uninitialised voice runtime (200 + empty engines)', async () => {
    const { registry } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/voice/status')!(fakeReq({ method: 'GET', url: '/api/voice/status' }), r.res);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).engines).toEqual([]);
  });

  it('presence.get passes status/body through with the JSON content type', async () => {
    const presence = { projects: [{ dir: 'C:/p', status: 'idle' }] };
    const { registry } = setup({ buildPresence: () => presence as any });
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/presence')!(fakeReq({ method: 'GET', url: '/api/presence' }), r.res);
    expect(r.status).toBe(200);
    expect(r.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(r.body)).toEqual(presence);
  });

  it('presence.get keeps the handler 500 arm (buildPresence throw)', async () => {
    const { registry } = setup({ buildPresence: () => { throw new Error('presence boom'); } });
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/presence')!(fakeReq({ method: 'GET', url: '/api/presence' }), r.res);
    expect(r.status).toBe(500);
    expect(JSON.parse(r.body)).toEqual({ error: 'presence boom' });
  });

  it('eval.chatCompletions wires the fixed provider/model/directory and returns result.status/body', async () => {
    mockEvalHandler.mockResolvedValue({ status: 201, body: { choices: [] } });
    const resolvedProjectDir = jest.fn(() => 'C:/proj/eval');
    const runtime = { marker: 'rt' };
    const { registry } = setup({ runtime: () => runtime, resolvedProjectDir });
    const r = fakeRes();
    const payload = { model: 'm', messages: [] };
    await handlerFor(registry, 'POST', '/api/eval/chat/completions')!(
      fakeReq({ method: 'POST', url: '/api/eval/chat/completions', body: JSON.stringify(payload) }),
      r.res,
    );
    expect(mockHandleEvalChatCompletion).toHaveBeenCalledWith({
      runtime,
      directory: 'C:/proj/eval',
      providerID: 'opencode-go',
      modelID: 'deepseek-v4-flash',
      timeoutMs: 300_000,
    });
    expect(mockEvalHandler).toHaveBeenCalledWith(payload);
    expect(r.status).toBe(201);
    expect(r.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(r.body)).toEqual({ choices: [] });
  });

  it('eval.chatCompletions keeps the 400 error arm (handler throw + bad JSON)', async () => {
    const errorSpy = jest.spyOn(log, 'error').mockImplementation(() => undefined as any);
    try {
      mockEvalHandler.mockRejectedValue(new Error('eval exploded'));
      const { registry } = setup();
      const r = fakeRes();
      await handlerFor(registry, 'POST', '/api/eval/chat/completions')!(
        fakeReq({ method: 'POST', url: '/api/eval/chat/completions', body: '{}' }),
        r.res,
      );
      expect(r.status).toBe(400);
      expect(JSON.parse(r.body)).toEqual({ error: { message: 'eval exploded' } });
      expect(errorSpy).toHaveBeenCalledWith('[Eval] chat error: eval exploded');

      const r2 = fakeRes();
      await handlerFor(registry, 'POST', '/api/eval/chat/completions')!(
        fakeReq({ method: 'POST', url: '/api/eval/chat/completions', body: 'not-json' }),
        r2.res,
      );
      expect(r2.status).toBe(400);
      expect(JSON.parse(r2.body).error.message).toBeTruthy();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('orchestration.outcomes parses the query and returns {outcomes}', async () => {
    const listGoalOutcomes = jest.fn(() => [{ goalId: 'g1' }]);
    const { registry } = setup({ getGatewayDb: () => ({ listGoalOutcomes } as any) });
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/orchestration/outcomes')!(
      fakeReq({ method: 'GET', url: '/api/orchestration/outcomes?policy=p&verdict=PASS&project=proj&limit=5' }),
      r.res,
    );
    expect(listGoalOutcomes).toHaveBeenCalledWith({ policy: 'p', verdict: 'PASS', project: 'proj', limit: 5 });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ outcomes: [{ goalId: 'g1' }] });
  });

  it('orchestration.outcomes defaults the limit to 100 and drops empty filters', async () => {
    const listGoalOutcomes = jest.fn(() => []);
    const { registry } = setup({ getGatewayDb: () => ({ listGoalOutcomes } as any) });
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/orchestration/outcomes')!(
      fakeReq({ method: 'GET', url: '/api/orchestration/outcomes' }),
      r.res,
    );
    expect(listGoalOutcomes).toHaveBeenCalledWith({ policy: undefined, verdict: undefined, project: undefined, limit: 100 });
  });

  it('providers.list runs capGuard first, then projects the runtime envelope', async () => {
    const capGuard = jest.fn(() => true);
    const list = jest.fn(async () => ({ all: [{ id: 'openai', models: [{ id: 'gpt-x' }] }] }));
    const { registry } = setup({ capGuard, runtime: () => ({ provider: { list } }) });
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/provider')!(fakeReq({ method: 'GET', url: '/api/provider' }), r.res);
    expect(capGuard).toHaveBeenCalledWith(r.res, 'provider.list');
    expect(list).not.toHaveBeenCalled();
    expect(r.body).toBe('');
  });

  it('providers.list projects providers and keeps the 503 / 500 arms', async () => {
    const { registry } = setup({
      runtime: () => ({ provider: { list: async () => ({ all: [{ id: 'openai', models: [{ id: 'gpt-x' }] }] }) } }),
    });
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/provider')!(fakeReq({ method: 'GET', url: '/api/provider' }), r.res);
    expect(JSON.parse(r.body).items).toEqual([{ id: 'openai', name: 'openai', models: [{ id: 'gpt-x', name: 'gpt-x', providerID: 'openai' }] }]);

    const nullSetup = setup({ runtime: () => null }).registry;
    const rNull = fakeRes();
    await handlerFor(nullSetup, 'GET', '/api/provider')!(fakeReq({ method: 'GET', url: '/api/provider' }), rNull.res);
    expect(rNull.status).toBe(503);
    expect(JSON.parse(rNull.body)).toEqual({ error: 'LLM client not available' });

    const errorSpy = jest.spyOn(log, 'error').mockImplementation(() => undefined as any);
    try {
      const boom = setup({ runtime: () => ({ provider: { list: async () => { throw new Error('prov fail'); } } }) }).registry;
      const rBoom = fakeRes();
      await handlerFor(boom, 'GET', '/api/provider')!(fakeReq({ method: 'GET', url: '/api/provider' }), rBoom.res);
      expect(rBoom.status).toBe(500);
      expect(JSON.parse(rBoom.body)).toEqual({ error: 'prov fail' });
      expect(errorSpy).toHaveBeenCalledWith('[Provider] list error:', 'prov fail');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('agents.list merges materialised identities ahead of runtime agents', async () => {
    const capGuard = jest.fn(() => false);
    const { registry } = setup({
      capGuard,
      runtime: () => ({ app: { agents: async () => [{ name: 'build', description: 'runtime builder', hidden: false }] } }),
      runtimeName: () => 'opencode',
      identityRegistry: () => ({
        list: () => [
          { name: 'manager', description: 'deprecated', scope: 'primary', deprecated: true },
          { name: 'explore', description: 'not materialised', scope: 'subagent', materialized: false },
          { name: 'general', description: 'primary agent', scope: 'primary' },
        ],
      }),
      identityState: () => ({ isMaterialized: (rt: string, name: string) => rt === 'opencode' && name === 'general' }),
    });
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/agents')!(fakeReq({ method: 'GET', url: '/api/agents' }), r.res);
    expect(capGuard).toHaveBeenCalledWith(r.res, 'provider.app.agents');
    const items = JSON.parse(r.body).items;
    expect(items.map((i: any) => i.id)).toEqual(['general', 'build']);
    expect(items[0]).toMatchObject({ source: 'mafw', selectable: true });
    expect(items[1]).toMatchObject({ source: 'runtime', selectable: true });
  });

  it('agents.list keeps the 503 arm when no runtime is active', async () => {
    const { registry } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/agents')!(fakeReq({ method: 'GET', url: '/api/agents' }), r.res);
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body)).toEqual({ error: 'LLM client not available' });
  });
});
