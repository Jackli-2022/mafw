import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { defineRuntime } from '@mafw/runtime-contract';
import { RuntimeBus } from '../../../src/runtime/runtime-bus';
import { createNeutralRuntime } from '../../../src/runtime/neutral-runtime';
import { RuntimePluginLoader } from '../../../src/runtime/loader';
import { toRuntimeDefinition, getBridgeEventEntry } from '../../../src/runtime/adapter-bridge';
import { createOpencodeDefinition } from '../../../src/runtime/opencode-definition';
import { OPENCODE_V1_EVENT_MAPPINGS } from '../../../src/runtime/opencode-events';
import { createOpencodeRuntime } from '../../../src/runtime/opencode-runtime';

jest.mock('@opencode-ai/sdk/v2', () => ({
  createOpencodeClient: jest.fn(() => ({})),
}));

function queuedRuntime(overrides: Record<string, unknown> = {}) {
  const queue: any[] = [];
  let wake: (() => void) | undefined;
  return {
    name: 'opencode',
    capabilities: {},
    session: {
      create: async () => ({ id: 's1' }),
      promptAsync: async () => {},
      abort: async () => {},
      messages: async () => ({ data: [] }),
    },
    global: {
      event: async () => ({
        stream: (async function* () {
          for (;;) {
            if (queue.length > 0) { yield queue.shift(); continue; }
            await new Promise<void>((resolve) => { wake = resolve; });
          }
        })(),
      }),
    },
    tools: { registerTools() {}, nativeTools: () => [] },
    emit(evt: any) {
      queue.push(evt);
      wake?.();
      wake = undefined;
    },
    ...overrides,
  } as any;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('opencode definition lifecycle', () => {
  it('carries the serve process primitives through the definition host', async () => {
    let spawned = 0;
    const runtime = queuedRuntime({
      agentProcess: {
        restart: async () => {},
        spawnServe: async () => { spawned += 1; return { url: 'http://serve' }; },
        killServe: () => {},
      },
    });
    const definition = await createOpencodeDefinition({ variant: 'v21', baseUrl: 'http://x' }, { runtime });
    const bus = new RuntimeBus();
    bus.register(definition);
    const neutral = createNeutralRuntime(definition, { bus });

    expect(typeof neutral.agentProcess?.spawnServe).toBe('function');
    await neutral.agentProcess!.spawnServe!({});
    expect(spawned).toBe(1);
    // The adapter's live base URL must survive activation (not the gateway port).
    expect(definition.host?.getBaseUrl).toBeUndefined();
  });

  it('keeps the adapter getBaseUrl when the definition provides one', async () => {
    const runtime = queuedRuntime({ getBaseUrl: () => 'http://serve:4096' });
    const definition = await createOpencodeDefinition({ variant: 'v21', baseUrl: 'http://x' }, { runtime });
    expect(definition.host?.getBaseUrl?.()).toBe('http://serve:4096');
    expect(definition.host?.activeDialect).toBe('v21');
  });

  it('defers the adaptive dialect probe until the first event', async () => {
    const runtime = queuedRuntime();
    let probes = 0;
    const definition = await createOpencodeDefinition(
      { variant: 'adaptive', baseUrl: 'http://x' },
      { runtime, probe: async () => { probes += 1; return 'v21'; } },
    );
    const bus = new RuntimeBus();
    bus.register(definition);
    const seen: any[] = [];
    bus.subscribe((delivered) => { if (delivered.canonical) seen.push(delivered.canonical); });

    // Cold start: nothing has subscribed/emitted yet, so the probe must not have run.
    expect(probes).toBe(0);

    runtime.emit({ type: 'session.renamed', data: { sessionID: 's1', title: 'renamed' } });
    const started = Date.now();
    while (seen.length === 0 && Date.now() - started < 1000) await tick();

    expect(probes).toBe(1);
    // v21 envelope shape: only the v21 entry can read `$.type` + `$.data`.
    expect(seen[0]?.payload.type).toBe('session.updated');
    expect(seen[0]?.payload.properties?.info).toMatchObject({ id: 's1', title: 'renamed' });
    expect(definition.host?.activeDialect).toBe('v21');
  });

  it('registers the translate entry under the loader key for dry-event', async () => {
    const definition = await createOpencodeDefinition(
      { variant: 'v1', baseUrl: 'http://x', registrationName: 'opencode@v1' },
      { runtime: queuedRuntime() },
    );
    expect(definition.name).toBe('opencode');
    expect(getBridgeEventEntry('opencode@v1')?.eventMappings).toBe(OPENCODE_V1_EVENT_MAPPINGS);
  });

  it('registers pinned entries at loader registration time (before activation)', async () => {
    const loader = new RuntimePluginLoader(fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-def-')));
    await loader.init();
    loader.registerBuiltinDefinition('pinned@v1', async () => { throw new Error('not activated'); }, {
      external: false,
      capabilities: { sessionApi: true } as any,
      eventEntry: { eventMappings: OPENCODE_V1_EVENT_MAPPINGS },
    });
    expect(getBridgeEventEntry('pinned@v1')?.eventMappings).toBe(OPENCODE_V1_EVENT_MAPPINGS);
  });

  it('prefers a neutral-format file plugin over a builtin definition', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-def-'));
    fs.writeFileSync(
      path.join(dir, 'x.js'),
      `module.exports = { name: 'x', api: 1, eventApi: 1, preset: 'core', transport: {\n` +
      `  createSession: async () => ({ sessionID: 's1' }),\n` +
      `  sendTurn: async (input) => ({ turnID: input.turnID }),\n` +
      `  interruptTurn: async () => {},\n` +
      `  onEvent: () => () => {},\n` +
      `} };`,
    );
    const loader = new RuntimePluginLoader(dir);
    await loader.init();
    let builtinBuilt = 0;
    loader.registerBuiltinDefinition('x', async () => { builtinBuilt += 1; return defineRuntime({
      api: 1, name: 'builtin-x', displayName: 'X', preset: 'core',
      transport: {
        createSession: async () => ({ sessionID: 's1' }),
        sendTurn: async (i) => ({ turnID: i.turnID }),
        interruptTurn: async () => {},
        onEvent: () => () => {},
      },
    }); }, { external: false, capabilities: {} as any });

    const resolved = await loader.resolveBuiltinDefinition('x', {});
    expect(builtinBuilt).toBe(0);
    expect(resolved?.name).toBe('x');
  });

  it('lets the definition getBaseUrl win over the composition-root default', () => {
    const definition = toRuntimeDefinition(
      { ...queuedRuntime(), getBaseUrl: () => 'http://serve:4096' },
      { name: 'x' },
    );
    const neutral = createNeutralRuntime(definition, {
      bus: new RuntimeBus(),
      host: { getBaseUrl: () => 'http://gateway:3000' },
    });
    expect(neutral.getBaseUrl()).toBe('http://serve:4096');
  });

  it('exposes the resolved dialect on the neutral runtime', async () => {
    const runtime = queuedRuntime();
    const definition = await createOpencodeDefinition(
      { variant: 'adaptive', baseUrl: 'http://x' },
      { runtime, probe: async () => 'v21' },
    );
    const bus = new RuntimeBus();
    bus.register(definition);
    const neutral: any = createNeutralRuntime(definition, { bus });
    runtime.emit({ type: 'session.renamed', data: { sessionID: 's1', title: 't' } });
    const started = Date.now();
    while (neutral.activeDialect !== 'v21' && Date.now() - started < 1000) await tick();
    expect(neutral.activeDialect).toBe('v21');
  });

  it('carries agentProcess from the real opencode runtime and passes validation', async () => {
    const real = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:1' });
    try {
      const definition = await createOpencodeDefinition(
        { variant: 'v21', baseUrl: 'http://127.0.0.1:1' },
        { runtime: real },
      );
      expect(typeof definition.host?.agentProcess?.spawnServe).toBe('function');
      expect(typeof definition.host?.agentProcess?.killServe).toBe('function');

      const neutral = createNeutralRuntime(definition, { bus: new RuntimeBus() });
      expect(typeof neutral.agentProcess?.spawnServe).toBe('function');
    } finally {
      await (real as any).dispose?.();
    }
  });
});

describe('definition caching', () => {
  it('builds a fresh definition on every activation', async () => {
    const loader = new RuntimePluginLoader(fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-def-')));
    await loader.init();
    let builds = 0;
    const make = () => defineRuntime({
      api: 1, name: 'x', displayName: 'X', preset: 'core',
      transport: {
        createSession: async () => ({ sessionID: 's1' }),
        sendTurn: async (input) => ({ turnID: input.turnID }),
        interruptTurn: async () => {},
        onEvent: () => () => {},
      },
    });
    loader.registerBuiltinDefinition('x', async () => { builds += 1; return make(); }, {
      external: false,
      capabilities: make().capabilities,
    });
    const first = await loader.resolveBuiltinDefinition('x', {});
    const second = await loader.resolveBuiltinDefinition('x', {});
    expect(builds).toBe(2);
    expect(first).not.toBe(second);
  });

  it('prefers a same-name file plugin over a builtin definition', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-def-'));
    fs.writeFileSync(path.join(dir, 'x.js'), `module.exports = { name: 'x', createRuntime: async () => ({ name: 'x', session: {} }) };`);
    const loader = new RuntimePluginLoader(dir);
    await loader.init();
    let builtinBuilt = 0;
    loader.registerBuiltinDefinition('x', async () => { builtinBuilt += 1; return defineRuntime({
      api: 1, name: 'x', displayName: 'X', preset: 'core',
      transport: {
        createSession: async () => ({ sessionID: 's1' }),
        sendTurn: async (i) => ({ turnID: i.turnID }),
        interruptTurn: async () => {},
        onEvent: () => () => {},
      },
    }); }, { external: false, capabilities: {} as any });

    const resolved = await loader.resolveBuiltinDefinition('x', {});
    expect(builtinBuilt).toBe(0);
    expect(resolved?.name).toBe('x');
  });
});

describe('turn attribution without turn.started', () => {
  it('gives each terminal its own minted id', async () => {
    const runtime = queuedRuntime();
    const definition = toRuntimeDefinition(runtime, { name: 'x' });
    const seen: any[] = [];
    definition.transport.onEvent((event) => seen.push(event));

    await definition.transport.sendTurn({ sessionID: 's1', turnID: 't1', text: 'one' } as any);
    await definition.transport.sendTurn({ sessionID: 's1', turnID: 't2', text: 'two' } as any);
    runtime.emit({ payload: { type: 'turn.completed', properties: { sessionID: 's1', ok: true } }, sessionID: 's1' });
    runtime.emit({ payload: { type: 'turn.completed', properties: { sessionID: 's1', ok: true } }, sessionID: 's1' });
    await tick();

    expect(seen.filter((event) => event.type === 'turn.completed').map((event) => event.turnID)).toEqual(['t1', 't2']);
  });
});
