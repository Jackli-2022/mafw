import { createOpencodeDefinition, resolveOpencodeEntry, opencodeStaticEntry, opencodeCapabilities } from '../../../../adapters/opencode/src/definition';
import { OPENCODE_V1_EVENT_MAPPINGS, OPENCODE_V2_EVENT_MAPPINGS } from '../../../../adapters/opencode/src/events';
import { OPENCODE_21_EVENT_MAPPINGS } from '../../../../adapters/opencode/src/events-21';
import { RuntimeBus } from '../../../src/runtime/runtime-bus';
import { createNeutralRuntime } from '../../../src/runtime/neutral-runtime';
import { validateRuntime } from '../../../src/runtime/validate';
import type { RuntimeFactoryContext } from '@mafw/runtime-contract';

const ctx = { pluginConfig: () => ({}) } as RuntimeFactoryContext;

function fakeRuntime(overrides: Record<string, unknown> = {}) {
  return {
    name: 'opencode',
    capabilities: {},
    getBaseUrl: () => 'http://x',
    proxyHeaders: () => ({ Authorization: 'Basic dGVzdA==' }),
    resolveProviderTransport: async () => ({ baseUrl: 'https://p.example/v1', apiKey: 'sk-x' }),
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
    agentProcess: {
      restart: async () => {},
      spawnServe: async () => ({ url: 'http://serve', close: () => {} }),
      killServe: () => {},
    },
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

  it('resolves adaptive to v21 when the probe says v21', async () => {
    const entry = await resolveOpencodeEntry('adaptive', 'http://x', { probe: async () => 'v21' });
    expect(entry.eventMappings).toBe(OPENCODE_21_EVENT_MAPPINGS);
  });
});

describe('opencodeStaticEntry / opencodeCapabilities', () => {
  it('returns the pinned entry without activation', () => {
    expect(opencodeStaticEntry('v1').eventMappings).toBe(OPENCODE_V1_EVENT_MAPPINGS);
    expect(opencodeStaticEntry('v2').eventMappings).toBe(OPENCODE_V2_EVENT_MAPPINGS);
    expect(opencodeStaticEntry('v21').eventMappings).toBe(OPENCODE_21_EVENT_MAPPINGS);
    // adaptive uses the v1 fail-safe until the first probe resolves.
    expect(opencodeStaticEntry('adaptive').eventMappings).toBe(OPENCODE_V1_EVENT_MAPPINGS);
  });

  it('narrows v1/v2 and external mode', () => {
    expect(opencodeCapabilities('v21', false)).toMatchObject({
      mcpApi: true, instructionsApi: true, discoveryApi: true, agentProcessApi: true,
    });
    expect(opencodeCapabilities('v2', false)).toMatchObject({
      instructionsApi: false, discoveryApi: false, agentProcessApi: true,
    });
    expect(opencodeCapabilities('v21', true)).toMatchObject({ agentProcessApi: false });
  });
});

describe('createOpencodeDefinition', () => {
  const saved = process.env.MAFW_SERVER_SERVE_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.MAFW_SERVER_SERVE_URL;
    else process.env.MAFW_SERVER_SERVE_URL = saved;
  });

  it('builds a neutral definition with api/eventApi 1 and the full capability set', async () => {
    delete process.env.MAFW_SERVER_SERVE_URL;
    const def = await createOpencodeDefinition(
      ctx,
      { variant: 'v2', baseUrl: 'http://x' },
      { runtime: fakeRuntime() },
    );
    expect(def.api).toBe(1);
    expect(def.eventApi).toBe(1);
    expect(def.name).toBe('opencode');
    expect(def.capabilities.mcpApi).toBe(true);
    expect(def.capabilities.instructionsApi).toBe(false); // v2 dialect lacks entries
    expect(def.capabilities.discoveryApi).toBe(false);
    expect(def.external).toBe(false);
    expect(typeof def.transport.sendTurn).toBe('function');
    expect(typeof def.host?.config?.get).toBe('function');
    // Serve proxy credentials are exposed through the host seam.
    expect(def.host?.proxyHeaders?.()).toMatchObject({ Authorization: expect.stringMatching(/^Basic /) });
    // Provider transport is carried for the gateway judge/scan paths.
    await expect(def.host?.resolveProviderTransport?.('p')).resolves.toMatchObject({
      baseUrl: 'https://p.example/v1',
    });
  });

  it('keeps instructions/discovery for the v21 dialect', async () => {
    delete process.env.MAFW_SERVER_SERVE_URL;
    const def = await createOpencodeDefinition(
      ctx,
      { variant: 'v21', baseUrl: 'http://x' },
      { runtime: fakeRuntime() },
    );
    expect(def.capabilities.instructionsApi).toBe(true);
    expect(def.capabilities.discoveryApi).toBe(true);
  });

  it('follows MAFW_SERVER_SERVE_URL for external mode', async () => {
    process.env.MAFW_SERVER_SERVE_URL = 'http://127.0.0.1:9999';
    const def = await createOpencodeDefinition(
      ctx,
      { variant: 'v21', baseUrl: 'http://127.0.0.1:9999' },
      { runtime: fakeRuntime() },
    );
    expect(def.external).toBe(true);
    expect(def.capabilities.agentProcessApi).toBe(false);
    // External runtimes must not expose the process primitive.
    expect(def.host?.agentProcess).toBeUndefined();
  });

  it('resolves the adaptive dialect at the first event', async () => {
    delete process.env.MAFW_SERVER_SERVE_URL;
    let probes = 0;
    const runtime = fakeRuntime();
    runtime.global.event = async () => ({
      stream: (async function* () {
        yield { id: 'v1', created: 1, type: 'session.renamed', data: { sessionID: 's1', title: 'renamed' } };
      })(),
    });
    const def = await createOpencodeDefinition(
      ctx,
      { variant: 'adaptive', baseUrl: 'http://x' },
      { runtime, probe: async () => { probes += 1; return 'v21'; } },
    );
    expect(probes).toBe(0);
    const bus = new RuntimeBus();
    bus.register(def);
    const seen: any[] = [];
    bus.subscribe((delivered) => { if (delivered.canonical) seen.push(delivered.canonical); });
    const started = Date.now();
    while (seen.length === 0 && Date.now() - started < 2000) await new Promise((r) => setTimeout(r, 5));
    expect(probes).toBe(1);
    expect(seen[0]?.payload.type).toBe('session.updated');
    expect(def.host?.activeDialect).toBe('v21');
  });

  it('passes runtime validation with the opencode capability set', async () => {
    delete process.env.MAFW_SERVER_SERVE_URL;
    const def = await createOpencodeDefinition(
      ctx,
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

describe('native definition transport', () => {
  it('emits validated AdapterEvents and echoes the gateway turn id', async () => {
    const raw = [
      { type: 'session.execution.started', data: { sessionID: 's1' } },
      { type: 'session.execution.succeeded', data: { sessionID: 's1', finish: 'stop' } },
    ];
    const runtime = fakeRuntime({
      global: {
        event: async () => ({
          stream: (async function* () {
            for (const event of raw) yield event;
          })(),
        }),
      },
    });
    const def = await createOpencodeDefinition(
      ctx,
      { variant: 'v21', baseUrl: 'http://x' },
      { runtime },
    );
    const seen: any[] = [];
    const unsubscribe = def.transport.onEvent((event) => seen.push(event));
    await def.transport.sendTurn({ sessionID: 's1', turnID: 't1', text: 'hi' });
    const started = Date.now();
    while (seen.length < 2 && Date.now() - started < 1500) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    unsubscribe();

    expect(seen.map((event) => event.type)).toEqual(
      expect.arrayContaining(['turn.started', 'turn.completed']),
    );
    expect(seen.every((event) => event.turnID === 't1')).toBe(true);
    for (const event of seen) {
      expect(event.id).toMatch(/^opencode_evt_/);
      expect(event.data).toBeDefined();
    }
  });

  it('maps steer to the native delivery hint', async () => {
    let delivered: any;
    const runtime = fakeRuntime({
      session: {
        ...fakeRuntime().session,
        promptAsync: async (input: any) => { delivered = input; },
      },
    });
    const def = await createOpencodeDefinition(
      ctx,
      { variant: 'v21', baseUrl: 'http://x' },
      { runtime },
    );
    await expect(def.transport.steer!('s1', 'go')).resolves.toBe('steered');
    expect(delivered).toMatchObject({ sessionID: 's1', message: 'go', delivery: 'steer', expectReply: false });
  });
});
