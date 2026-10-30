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
});
