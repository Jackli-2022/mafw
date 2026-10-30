import { validateRuntime } from '../../../src/runtime/validate';
import { fullCapabilities, minimalCapabilities } from '../../../src/runtime/contract';

function fakeRuntime(over: any = {}) {
  const session: any = {};
  for (const m of ['create', 'promptAsync', 'prompt', 'messages', 'get', 'delete', 'abort', 'list', 'todo', 'children', 'summarize']) session[m] = async () => ({});
  return {
    name: 'fake',
    capabilities: { ...minimalCapabilities(), ...over },
    session,
    global: { event: async () => ({}) },
    provider: { list: async () => ({ all: [], connected: [], default: {} }) },
    app: { agents: async () => [] },
    config: { get: async () => ({}), update: async (c: any) => c },
    tools: { registerTools: async () => {}, nativeTools: () => [] },
    getBaseUrl: () => 'http://127.0.0.1:1',
    ...over,
  } as any;
}

describe('manifest-driven validateRuntime', () => {
  it('does not hard-fail global.event when eventStream is false', () => {
    const rt = fakeRuntime({ global: undefined });
    expect(validateRuntime(rt, 'test').hard).toEqual([]);
  });

  it('hard-fails global.event when eventStream is true', () => {
    const rt = fakeRuntime({ capabilities: { ...fullCapabilities(), eventStream: true }, global: undefined });
    expect(validateRuntime(rt, 'test').hard.join('\n')).toMatch(/events\.global/);
  });

  it('hard-fails providerConfigApi sub-methods', () => {
    const rt = fakeRuntime({ capabilities: { ...fullCapabilities(), providerConfigApi: true }, provider: undefined });
    expect(validateRuntime(rt, 'test').hard.join('\n')).toMatch(/provider\.list/);
  });

  it('downgrades a capability only when its requires surface is missing', () => {
    const rt = fakeRuntime({ capabilities: { ...fullCapabilities(), sessionBranchApi: true } });
    const v = validateRuntime(rt, 'test');
    expect(v.downgraded.join('\n')).toMatch(/sessionBranchApi/);
  });

  it('keeps nativeApprovals when permissionReply exists but permissionList is missing', () => {
    const rt = fakeRuntime({
      capabilities: { ...fullCapabilities(), nativeApprovals: true },
      session: { ...fakeRuntime().session, permissionReply: async () => true },
    });
    const v = validateRuntime(rt, 'test');
    expect(v.downgraded.join('\n')).not.toMatch(/nativeApprovals/);
    expect(v.warnings.join('\n')).toMatch(/approval\.permissionList/);
  });

  it('warns for optional session.update but does not downgrade', () => {
    const v = validateRuntime(fakeRuntime(), 'test');
    expect(v.warnings.join('\n')).toMatch(/session\.update/);
    expect(v.staticCoverage?.static.surfaces['session.update'].status).toBe('missing');
  });

  it('returns static coverage', () => {
    const v = validateRuntime(fakeRuntime(), 'test');
    expect(v.staticCoverage?.runtime).toBe('fake');
    expect(v.staticCoverage?.static.surfaces['session.create'].status).toBe('present');
  });

  it('requires config.get, not just a config container', () => {
    const rt = fakeRuntime({
      capabilities: { ...fullCapabilities(), providerConfigApi: true },
      config: { update: async (c: any) => c },
    });
    expect(validateRuntime(rt, 'test').hard.join('\n')).toMatch(/config\.get/);
  });

  it('downgrades questionApi when session.question is an empty container', () => {
    const rt = fakeRuntime({
      capabilities: { ...fullCapabilities(), questionApi: true },
      session: { ...fakeRuntime().session, question: {} },
    });
    expect(validateRuntime(rt, 'test').downgraded.join('\n')).toMatch(/questionApi/);
  });

  it('downgrades instructionsApi when session.instructions is an empty container', () => {
    const rt = fakeRuntime({
      capabilities: { ...fullCapabilities(), instructionsApi: true },
      session: { ...fakeRuntime().session, instructions: {} },
    });
    expect(validateRuntime(rt, 'test').downgraded.join('\n')).toMatch(/instructionsApi/);
  });

  it('does not warn for the agentConfigApi unlock-only agents.remove surface', () => {
    const rt = fakeRuntime({
      capabilities: { ...fullCapabilities(), agentConfigApi: true },
      agents: { install: async () => {} },
    });
    expect(validateRuntime(rt, 'test').warnings.join('\n')).not.toMatch(/identity\.agents\.remove/);
  });

  it('emits one config hard error when config is entirely absent', () => {
    const rt = fakeRuntime({
      capabilities: { ...fullCapabilities(), providerConfigApi: true },
      config: undefined,
    });
    const hard = validateRuntime(rt, 'test').hard.filter((h) => h.includes('config'));
    expect(hard).toHaveLength(1);
  });

  it('does not warn about plugin declaration surfaces when the activation subject carries them', () => {
    const rt = fakeRuntime({ capabilities: { ...minimalCapabilities(), eventStream: true } });
    const v = validateRuntime(rt, 'test', {
      declaration: {
        eventSource: { typePath: '$.type' },
        eventMappings: [],
        transformEvent: () => null,
      },
      plugin: { name: 'fake', createRuntime: () => {}, external: true, capabilities: rt.capabilities },
      source: 'active',
    });
    expect(v.downgraded).toEqual([]);
    expect(v.warnings.filter((w) => w.includes('plugin.'))).toEqual([]);
  });
});
