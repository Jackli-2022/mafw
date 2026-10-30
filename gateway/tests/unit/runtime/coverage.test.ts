import { computeCoverage, applyBehaviorResults, applyEventStreamDeclarationDowngrade, probePasses, type ContractSubject } from '../../../src/runtime/coverage';
import { buildRuntimeContractManifest } from '../../../src/runtime/contract-manifest';
import { fullCapabilities, minimalCapabilities } from '../../../src/runtime/contract';

function fakeRuntime(over: any = {}) {
  const session: any = {};
  for (const m of ['create', 'promptAsync', 'prompt', 'messages', 'get', 'delete', 'abort', 'list', 'todo', 'children', 'summarize']) session[m] = async () => ({});
  return {
    name: 'fake',
    capabilities: { ...minimalCapabilities(), ...over },
    session,
    global: { event: async () => ({ stream: (async function* () {})() }) },
    provider: { list: async () => ({ all: [], connected: [], default: {} }) },
    app: { agents: async () => [] },
    config: { get: async () => ({}), update: async (c: any) => c },
    tools: { registerTools: async () => {}, nativeTools: () => [] },
    getBaseUrl: () => 'http://127.0.0.1:1',
    ...over,
  } as any;
}

const manifest = buildRuntimeContractManifest();

describe('coverage engine', () => {
  it('marks required presence surfaces present for a full fake runtime', () => {
    const c = computeCoverage({ rt: fakeRuntime(), source: 'active' }, manifest);
    expect(c.static.surfaces['session.create'].status).toBe('present');
    expect(c.static.surfaces['tools.registerTools'].status).toBe('present');
    expect(c.static.surfaces['events.global'].status).toBe('present');
  });

  it('marks a missing gated surface missing without mutating capabilities', () => {
    const rt = fakeRuntime({ capabilities: { ...fullCapabilities(), sessionBranchApi: true } });
    const c = computeCoverage({ rt, source: 'active' }, manifest);
    expect(c.static.surfaces['branch.fork'].status).toBe('missing');
    expect(rt.capabilities.sessionBranchApi).toBe(true);
  });

  it('probes declaration surfaces from the subject declaration bag', () => {
    const rt = fakeRuntime({ capabilities: { ...fullCapabilities(), eventStream: true } });
    const withDecl = computeCoverage({
      rt, source: 'file',
      declaration: { eventSource: { typePath: '$.type' }, eventMappings: [] },
      plugin: { name: 'x', createRuntime: () => {} },
    }, manifest);
    expect(withDecl.static.surfaces['plugin.eventMappings'].status).toBe('present');
    expect(withDecl.static.surfaces['plugin.createRuntime'].status).toBe('present');
    const withoutDecl = computeCoverage({ rt, source: 'file' }, manifest);
    expect(withoutDecl.static.surfaces['plugin.eventMappings'].status).toBe('missing');
  });

  it('keeps attested surfaces unverified', () => {
    const c = computeCoverage({ rt: fakeRuntime({ capabilities: { ...fullCapabilities(), turnBudgetApi: true } }), source: 'active' }, manifest);
    expect(c.static.surfaces['prompt.maxTurns'].status).toBe('unverified');
    expect(c.static.unverified.some((u) => u.id === 'prompt.maxTurns')).toBe(true);
  });

  it('marks cognition surfaces unverified (gateway serves the endpoint)', () => {
    const c = computeCoverage({ rt: fakeRuntime(), source: 'active' }, manifest);
    expect(c.static.surfaces['cognition.observe'].status).toBe('unverified');
  });

  it('applies behavior results without overwriting presence results', () => {
    const c = computeCoverage({ rt: fakeRuntime(), source: 'active' }, manifest);
    const next = applyBehaviorResults(c, [{ surfaceId: 'prompt.result.usage', status: 'failed', detail: 'missing usage' }]);
    expect(next.behavioral?.failed).toContain('prompt.result.usage');
    expect(next.static.surfaces['prompt.result.usage'].status).toBe('unverified');
  });

  it('tracks behavioral details and the unverified remainder', () => {
    const c = computeCoverage({ rt: fakeRuntime(), source: 'active' }, manifest);
    const next = applyBehaviorResults(c, [
      { surfaceId: 'prompt.result.usage', status: 'failed', detail: 'usage missing' },
      { surfaceId: 'prompt.parts.file', status: 'verified' },
    ]);
    expect(next.behavioral?.details['prompt.result.usage']).toBe('usage missing');
    expect(next.behavioral?.verified).toContain('prompt.parts.file');
    expect(next.behavioral?.unverified).not.toContain('prompt.result.usage');
    expect(next.behavioral?.unverified).not.toContain('prompt.parts.file');
    expect(next.behavioral?.unverified).toContain('prompt.agent');
  });

  it('rejects non-function rt probes (container/value false positive)', () => {
    const rt = fakeRuntime({
      session: { ...fakeRuntime().session, update: true, question: {}, instructions: {} },
      config: { update: async (c: any) => c },
    });
    const subject: ContractSubject = { rt, source: 'active' };
    const s = buildRuntimeContractManifest().surfaces;
    expect(probePasses(subject, s.find((x) => x.id === 'session.update')!)).toBe(false);
    expect(probePasses(subject, s.find((x) => x.id === 'approval.question.reply')!)).toBe(false);
    expect(probePasses(subject, s.find((x) => x.id === 'session.instructions.put')!)).toBe(false);
    expect(probePasses(subject, s.find((x) => x.id === 'provider.config')!)).toBe(false);
  });

  it('downgrades eventStream before coverage so effective matches capabilities', () => {
    const rt = fakeRuntime({ capabilities: { ...minimalCapabilities(), eventStream: true } });
    expect(applyEventStreamDeclarationDowngrade(rt, false)).toBe(true);
    const c = computeCoverage({ rt, source: 'file' }, manifest);
    expect(c.static.effective.eventStream).toBe(false);
    expect(c.static.surfaces['plugin.eventMappings'].status).toBe('missing');
  });

  it('probePasses supports rt/declaration/plugin prefixes', () => {
    const subject: ContractSubject = {
      rt: fakeRuntime(),
      source: 'file',
      declaration: { eventMappings: [] },
      plugin: { createRuntime: () => {} },
    };
    const s = buildRuntimeContractManifest().surfaces;
    expect(probePasses(subject, s.find((x) => x.id === 'session.create')!)).toBe(true);
    expect(probePasses(subject, s.find((x) => x.id === 'plugin.eventMappings')!)).toBe(true);
    expect(probePasses(subject, s.find((x) => x.id === 'plugin.createRuntime')!)).toBe(true);
  });
});
