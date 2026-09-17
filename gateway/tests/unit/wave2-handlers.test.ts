import { EventEmitter } from 'events';
import { RouteRegistry } from '../../src/routes/registry';
import { buildRouteCatalog } from '../../src/routes/route-catalog';
import { attachWave2Handlers, type Wave2Gateway } from '../../src/routes/wave2-handlers';

const WAVE2_OPIDS = [
  'runtime.get', 'runtime.switch', 'runtime.reload', 'runtime.restartAgent',
  'plugins.list', 'plugins.install', 'plugins.enable', 'plugins.disable', 'plugins.delete',
];

function mockRes() {
  const res: any = {
    status: 0, body: '', headers: {} as Record<string, string>,
    writeHead(s: number, h?: Record<string, string>) { this.status = s; if (h) Object.assign(this.headers, h); },
    end(b?: string) { this.body = b ?? ''; this.ended = true; },
  };
  return res;
}

function mockReqWithBody(body: unknown) {
  const req = new EventEmitter() as any;
  req.method = 'POST';
  req.url = '/x';
  process.nextTick(() => {
    req.emit('data', JSON.stringify(body));
    req.emit('end');
  });
  return req;
}

function fakeGw(over: Partial<Wave2Gateway> = {}): Wave2Gateway {
  return {
    runtimeDeps: jest.fn(() => ({})) as any,
    restartAgentDeps: jest.fn(() => ({})) as any,
    pluginHubDeps: jest.fn((() => ({ hub: { dirs: {} } })) as any),
    runtimeSwitchBlocked: jest.fn(() => false),
    beginRuntimeSwitch: jest.fn(),
    endRuntimeSwitch: jest.fn(),
    ...over,
  };
}

function buildAttached(gw?: Partial<Wave2Gateway>) {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachWave2Handlers(registry, fakeGw(gw));
  return { registry, gw: (registry as any) };
}

describe('wave2-handlers: 迁移覆盖率', () => {
  it('9 条 Wave 2 路由全部 attach', () => {
    const registry = new RouteRegistry().register(...buildRouteCatalog());
    attachWave2Handlers(registry, fakeGw());
    const attached = registry.attachedOperationIds();
    for (const id of WAVE2_OPIDS) expect(attached.has(id)).toBe(true);
  });

  it('spec 形状不变（attach 只加 handler 不改 paths）', () => {
    const before = new RouteRegistry().register(...buildRouteCatalog()).toOpenApiPaths();
    const registry = new RouteRegistry().register(...buildRouteCatalog());
    attachWave2Handlers(registry, fakeGw());
    expect(registry.toOpenApiPaths()).toEqual(before);
  });

  const cases: Array<[string, string, string]> = [
    ['GET', '/api/runtime', 'runtime.get'],
    ['POST', '/api/runtime/switch', 'runtime.switch'],
    ['POST', '/api/runtime/reload', 'runtime.reload'],
    ['POST', '/api/runtime/restart-agent', 'runtime.restartAgent'],
    ['GET', '/api/plugins', 'plugins.list'],
    ['POST', '/api/plugins/install', 'plugins.install'],
    ['POST', '/api/plugins/enable', 'plugins.enable'],
    ['POST', '/api/plugins/disable', 'plugins.disable'],
    ['POST', '/api/plugins/delete', 'plugins.delete'],
  ];
  for (const [method, url, opId] of cases) {
    it(`${method} ${url} → ${opId}`, () => {
      const registry = new RouteRegistry().register(...buildRouteCatalog());
      attachWave2Handlers(registry, fakeGw());
      const m = registry.match(method as any, url);
      expect(m?.def.operationId).toBe(opId);
      expect(m?.def.handler).toBeDefined();
    });
  }
});

describe('wave2-handlers: runtime.switch 守卫', () => {
  it('blocked → 409 且不进入 switch 流程', async () => {
    const registry = new RouteRegistry().register(...buildRouteCatalog());
    const gw = fakeGw({
      runtimeSwitchBlocked: jest.fn(() => true),
      runtimeDeps: jest.fn(() => { throw new Error('should not reach deps'); }),
    });
    attachWave2Handlers(registry, gw);
    const m = registry.match('POST', '/api/runtime/switch')!;
    const res = mockRes();
    await m.def.handler!(mockReqWithBody({ plugin: 'pi' }), res, {});
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Cannot switch runtime');
    expect(gw.beginRuntimeSwitch).not.toHaveBeenCalled();
  });

  it('unblocked → begin/finally end 成对执行', async () => {
    const registry = new RouteRegistry().register(...buildRouteCatalog());
    const callOrder: string[] = [];
    const gw = fakeGw({
      runtimeDeps: jest.fn((() => ({})) as any),
      beginRuntimeSwitch: jest.fn(() => callOrder.push('begin')),
      endRuntimeSwitch: jest.fn(() => callOrder.push('end')),
    });
    attachWave2Handlers(registry, gw);
    const m = registry.match('POST', '/api/runtime/switch')!;
    const res = mockRes();
    await m.def.handler!(mockReqWithBody({ plugin: '' }), res, {});
    expect(callOrder).toEqual(['begin', 'end']);
    expect(gw.runtimeSwitchBlocked).toHaveBeenCalled();
  });

  it('deps 抛错时 end 仍执行（finally 语义）', async () => {
    const registry = new RouteRegistry().register(...buildRouteCatalog());
    let ended = false;
    const gw = fakeGw({
      runtimeDeps: jest.fn(() => { throw new Error('boom'); }),
      endRuntimeSwitch: jest.fn(() => { ended = true; }),
    });
    attachWave2Handlers(registry, gw);
    const m = registry.match('POST', '/api/runtime/switch')!;
    await expect(m.def.handler!(mockReqWithBody({ plugin: 'x' }), mockRes(), {})).rejects.toThrow('boom');
    expect(ended).toBe(true);
  });
});
