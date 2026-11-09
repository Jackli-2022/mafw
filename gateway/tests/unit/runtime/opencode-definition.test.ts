import { resolveOpencodeEntry, createOpencodeDefinition } from '../../../src/runtime/opencode-definition';
import { OPENCODE_V1_EVENT_MAPPINGS, OPENCODE_V2_EVENT_MAPPINGS } from '../../../src/runtime/opencode-events';
import { OPENCODE_21_EVENT_MAPPINGS } from '../../../src/runtime/opencode-21-events';
import { RuntimeBus } from '../../../src/runtime/runtime-bus';
import { createNeutralRuntime } from '../../../src/runtime/neutral-runtime';
import { validateRuntime } from '../../../src/runtime/validate';

function fakeRuntime(overrides: Record<string, unknown> = {}) {
  return {
    name: 'opencode',
    capabilities: {},
    session: {
      create: async () => ({ id: 's1' }),
      promptAsync: async () => {},
      abort: async () => {},
      messages: async () => ({ data: [] }),
      list: async () => [],
      listByDirectory: async () => [],
      get: async () => ({ id: 's1' }),
      update: async () => ({}),
      delete: async () => {},
      todo: async () => [],
      children: async () => [],
      summarize: async () => ({}),
      permissionList: async () => [],
      permissionReply: async () => true,
      question: {
        list: async () => [],
        reply: async () => {},
        reject: async () => {},
      },
      fork: async () => ({ id: 's2' }),
      revert: async () => {},
      unrevert: async () => {},
      diff: async () => [],
      vcs: { diff: async () => [], apply: async () => {} },
    },
    global: { event: async () => ({ stream: (async function* () {})() }) },
    provider: { list: async () => ({ all: [], connected: [], default: {} }) },
    app: { agents: async () => [] },
    tools: { registerTools() {}, nativeTools: () => [] },
    config: { get: async () => ({}), update: async () => ({}) },
    completion: { complete: async () => ({ text: '' }) },
    credentials: { getApiKey: () => null },
    mcp: { list: async () => [], connect: async () => true, disconnect: async () => true, config: {} },
    discovery: { list: async () => ({ commands: [], skills: [], warnings: [] }) },
    pty: { create: async () => ({ id: 'p1' }), connect: async () => ({ id: 'p1' }), resize: async () => {}, remove: async () => {} },
    snapshotTree: { locate: async () => null },
    agents: { install: async () => {} },
    ...overrides,
  } as any;
}

describe('resolveOpencodeEntry', () => {
  it('uses the probed dialect for the adaptive name', async () => {
    const entry = await resolveOpencodeEntry('adaptive', 'http://x', { probe: async () => 'v2' });
    expect(entry.eventMappings).toBe(OPENCODE_V2_EVENT_MAPPINGS);
  });

  it('falls back to v1 when the probe fails', async () => {
    const entry = await resolveOpencodeEntry('adaptive', 'http://x', { probe: async () => { throw new Error('down'); } });
    expect(entry.eventMappings).toBe(OPENCODE_V1_EVENT_MAPPINGS);
  });

  it('pins the v21 source shape', async () => {
    const entry = await resolveOpencodeEntry('v21', 'http://x', {});
    expect(entry.eventSource?.typePath).toBe('$.type');
    expect(entry.eventMappings).toBe(OPENCODE_21_EVENT_MAPPINGS);
  });
});

describe('createOpencodeDefinition', () => {
  it('builds a neutral definition with the full capability set', async () => {
    const def = await createOpencodeDefinition(
      { variant: 'v2', baseUrl: 'http://x' },
      { runtime: fakeRuntime() },
    );
    expect(def.name).toBe('opencode');
    expect(def.capabilities.mcpApi).toBe(true);
    expect(def.capabilities.instructionsApi).toBe(false); // v2 dialect lacks entries
    expect(def.capabilities.discoveryApi).toBe(false);
    expect(def.external).toBe(false);
    expect(typeof def.transport.sendTurn).toBe('function');
    expect(typeof def.host?.config?.get).toBe('function');
  });

  it('keeps instructions/discovery for the v21 dialect', async () => {
    const def = await createOpencodeDefinition(
      { variant: 'v21', baseUrl: 'http://x' },
      { runtime: fakeRuntime() },
    );
    expect(def.capabilities.instructionsApi).toBe(true);
    expect(def.capabilities.discoveryApi).toBe(true);
  });

  it('passes runtime validation with the opencode capability set', async () => {
    const def = await createOpencodeDefinition(
      { variant: 'v21', baseUrl: 'http://x' },
      { runtime: fakeRuntime() },
    );
    const bus = new RuntimeBus();
    bus.register(def);
    const runtime = createNeutralRuntime(def, { bus });
    const validation = validateRuntime(runtime, 'opencode', {
      declaration: { eventTranslation: 'self' },
      plugin: {
        name: 'opencode',
        createRuntime: () => {},
        external: false,
        capabilities: def.capabilities,
      },
      source: 'active',
      declaredCapabilityKeys: Object.keys(def.capabilities),
    });
    expect(validation.hard).toEqual([]);
  });
});
