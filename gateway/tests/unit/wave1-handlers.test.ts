import { RouteRegistry } from '../../src/routes/registry';
import { buildRouteCatalog } from '../../src/routes/route-catalog';
import { attachWave1Handlers, type Wave1Gateway } from '../../src/routes/wave1-handlers';

const WAVE1_OPIDS = [
  'goals.sessions', 'triage.dismiss', 'manager.rotate',
  'embedding.get', 'embedding.update', 'models.get', 'models.update',
  'session.fork', 'session.revert', 'session.unrevert', 'session.delete', 'session.rename', 'session.summarize',
  'event.publish', 'media.switch',
  'session.usagePluginsList', 'session.usagePluginsReload', 'session.usagePluginsCreate',
  'session.usagePluginSourceGet', 'session.usagePluginSourcePut', 'session.usagePluginTest', 'session.usagePluginsDelete',
];

function fakeGw(over: Partial<Wave1Gateway> = {}): Wave1Gateway {
  return {
    getGatewayDb: jest.fn(() => ({ listGoalSessions: jest.fn(async () => []) })),
    runtime: null,
    automationEngine: { rejectTriage: jest.fn(() => true) },
    ledger: { append: jest.fn() },
    rotateDeps: jest.fn((() => ({})) as any),
    embeddingConfigDeps: jest.fn((() => ({})) as any),
    modelConfigDeps: jest.fn((() => ({})) as any),
    usagePluginsDeps: jest.fn((() => ({})) as any),
    pluginLoader: { reload: jest.fn(async () => {}) },
    mediaPluginLoader: { reload: jest.fn(async () => {}), getState: jest.fn(() => []) },
    broadcast: jest.fn(),
    runtimeCaps: { sessionApi: true },
    ...over,
  };
}

function buildAttached(gw?: Partial<Wave1Gateway>) {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachWave1Handlers(registry, fakeGw(gw));
  return registry;
}

describe('wave1-handlers: 迁移覆盖率', () => {
  it('22 条 Wave 1 路由全部 attach', () => {
    const attached = buildAttached().attachedOperationIds();
    expect(attached.size).toBe(WAVE1_OPIDS.length);
    for (const id of WAVE1_OPIDS) expect(attached.has(id)).toBe(true);
  });

  it('attach 不改变 spec 形状（operationId 集合不变）', () => {
    const before = new RouteRegistry().register(...buildRouteCatalog()).toOpenApiPaths();
    const after = buildAttached().toOpenApiPaths();
    expect(after).toEqual(before);
  });

  it('attachHandler 防御：未知 operationId / 重复 attach 抛错', () => {
    const registry = new RouteRegistry().register(...buildRouteCatalog());
    expect(() => registry.attachHandler('nope.nope', async () => {})).toThrow('unknown operationId');
    attachWave1Handlers(registry, fakeGw());
    expect(() => registry.attachHandler('triage.dismiss', async () => {})).toThrow('already has a handler');
  });

  describe('match smoke：Wave 1 路径命中 handler', () => {
    const cases: Array<[string, string, string]> = [
      ['GET', '/api/goals/g1/sessions', 'goals.sessions'],
      ['POST', '/api/triage/t1/dismiss', 'triage.dismiss'],
      ['POST', '/api/manager/session/rotate', 'manager.rotate'],
      ['GET', '/api/memory/embedding-config', 'embedding.get'],
      ['POST', '/api/memory/embedding-config', 'embedding.update'],
      ['GET', '/api/model-config', 'models.get'],
      ['POST', '/api/sessions/s1/fork', 'session.fork'],
      ['DELETE', '/api/sessions/s1', 'session.delete'],
      ['PATCH', '/api/sessions/s1', 'session.rename'],
      ['POST', '/api/session/s1/summarize', 'session.summarize'],
      ['POST', '/api/events', 'event.publish'],
      ['POST', '/api/media/switch', 'media.switch'],
      ['GET', '/api/usage/plugins', 'session.usagePluginsList'],
      ['POST', '/api/usage/plugins/reload', 'session.usagePluginsReload'],
      ['DELETE', '/api/usage/plugins/my-plug', 'session.usagePluginsDelete'],
    ];
    for (const [method, url, opId] of cases) {
      it(`${method} ${url} → ${opId}`, () => {
        const m = buildAttached().match(method as any, url);
        expect(m?.def.operationId).toBe(opId);
        expect(m?.def.handler).toBeDefined();
      });
    }
  });

  it('Wave 2 路径仍为 shadow（无 handler，落回 legacy 链）', () => {
    const registry = buildAttached();
    expect(registry.match('GET', '/api/runtime')?.def.handler).toBeUndefined();
    expect(registry.match('GET', '/api/plugins')?.def.handler).toBeUndefined();
  });

  it('usage source/test 路由提取 :name 参数', () => {
    const m = buildAttached().match('GET', '/api/usage/plugins/my-plug/source');
    expect(m?.def.operationId).toBe('session.usagePluginSourceGet');
    expect(m?.params.name).toBe('my-plug');
  });

  it('param 名未在静态段时静态优先（/api/usage/plugins/create 不被 :name 吞）', () => {
    const m = buildAttached().match('POST', '/api/usage/plugins/create');
    expect(m?.def.operationId).toBe('session.usagePluginsCreate');
  });
});
