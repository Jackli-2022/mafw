import { defineRuntime, type RuntimeDefinition, type RuntimeTransport } from '@mafw/runtime-contract';
import { RuntimeBus } from '../../../src/runtime/runtime-bus';
import { createNeutralRuntime } from '../../../src/runtime/neutral-runtime';
import { createRuntimeFacade } from '../../../src/runtime/runtime-facade';
import { toRuntimeDefinition } from '../../../src/runtime/adapter-bridge';
import { validateRuntime } from '../../../src/runtime/validate';
import { createPiDefinition } from '../../../src/runtime/pi/pi-definition';
import type { RuntimePluginContext } from '../../../src/runtime/loader';

function transport(overrides: Partial<RuntimeTransport> = {}): RuntimeTransport {
  return {
    createSession: async () => ({ sessionID: 's1' }),
    sendTurn: async (input) => ({ turnID: input.turnID }),
    interruptTurn: async () => {},
    onEvent: () => () => {},
    ...overrides,
  };
}

function def(overrides: Partial<RuntimeTransport> = {}, extra: Partial<RuntimeDefinition> = {}): RuntimeDefinition {
  return defineRuntime({
    api: 1, name: 'fake', displayName: 'Fake', preset: 'core',
    transport: transport(overrides),
    ...extra,
  } as any);
}

function canonical(type: string, properties: Record<string, unknown> = {}) {
  return { payload: { type, properties }, sessionID: 's1' };
}

let seq = 0;
function adapterEvent(type: string, data: any, extra: any = {}) {
  seq += 1;
  return { id: `e-${seq}`, type, sessionID: 's1', at: Date.now(), data, ...extra } as any;
}

const tick = () => new Promise((r) => setTimeout(r, 20));

describe('pi activation parity', () => {
  function fakeCtx(): RuntimePluginContext {
    return {
      fetch: async () => new Response(''),
      log: { info() {}, warn() {}, error() {}, debug() {} } as any,
      pluginConfig: () => ({}),
      credentials: { getApiKey: () => null },
      gatewayPort: 3000,
      projectDir: process.cwd(),
      rootDir: process.cwd(),
    };
  }

  it('passes runtime validation with the real capability set', async () => {
    const definition = await createPiDefinition(fakeCtx(), { loadPi: async () => ({}) });
    const bus = new RuntimeBus();
    bus.register(definition);
    const runtime = createNeutralRuntime(definition, { bus });

    const validation = validateRuntime(runtime, 'pi', {
      declaration: { eventTranslation: 'self' },
      plugin: {
        name: 'pi',
        createRuntime: () => {},
        external: true,
        capabilities: definition.capabilities,
      },
      source: 'active',
      declaredCapabilityKeys: Object.keys(definition.capabilities),
    });
    expect(validation.hard).toEqual([]);
  });

  it('keeps the external flag so startup subscribes to the event stream', async () => {
    const definition = await createPiDefinition(fakeCtx(), { loadPi: async () => ({}) });
    expect(definition.external).toBe(true);
  });

  it('exposes the host surfaces the capability set promises', async () => {
    const definition = await createPiDefinition(fakeCtx(), { loadPi: async () => ({}) });
    expect(typeof definition.host?.config?.get).toBe('function');
    expect(typeof definition.host?.completion?.complete).toBe('function');
    expect(typeof definition.host?.credentials?.getApiKey).toBe('function');
  });
});

describe('neutral runtime parity', () => {
  it('normalises history through the messages channel', async () => {
    const raw = [{ role: 'assistant', content: 'hi', timestamp: 1 }];
    const definition = def({}, {
      channels: {
        messages: {
          list: async () => ({ data: raw }),
          normalize: (items) => (items as any[]).map((m) => ({
            id: 'm1', sessionID: 's1', role: m.role, parts: [{ type: 'text', text: m.content }],
          })),
        },
      },
    } as any);
    const runtime = createNeutralRuntime(definition, { bus: new RuntimeBus() });
    const result: any = await runtime.session.messages({ sessionID: 's1' });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ id: 'm1', role: 'assistant' });
  });

  it('does not mount session.messages without a messages channel', () => {
    const runtime = createNeutralRuntime(def(), { bus: new RuntimeBus() });
    expect((runtime.session as any).messages).toBeUndefined();
  });

  it('assembles tool primitives into a part snapshot through the neutral facade', async () => {
    const bus = new RuntimeBus();
    const definition = def();
    bus.register(definition);
    const runtime = createNeutralRuntime(definition, { bus });
    const facade = await createRuntimeFacade(runtime, {
      neutral: true,
      entry: { eventTranslation: 'self' },
      isCanonical: () => true,
    });

    const seen: any[] = [];
    const result: any = await facade.global.event();
    const consume = (async () => {
      for await (const evt of result.stream) {
        seen.push(evt);
        if (seen.some((e) => e.payload.type === 'part.updated'
          && e.payload.properties?.part?.type === 'tool'
          && e.payload.properties.part.state?.status === 'completed')) return;
      }
    })();

    bus.dispatch(adapterEvent('tool.call', { callID: 'c1', name: 'bash', input: { command: 'ls' } }, { turnID: 't1' }));
    bus.dispatch(adapterEvent('tool.result', { callID: 'c1', ok: true, output: 'ok' }, { turnID: 't1' }));
    await Promise.race([consume, tick().then(() => { throw new Error('no assembled tool part'); })]);

    const part = seen
      .filter((e) => e.payload.type === 'part.updated' && e.payload.properties?.part?.type === 'tool')
      .at(-1);
    expect(part?.payload.properties.part.tool).toBe('bash');
    expect(part?.payload.properties.part.state?.status).toBe('completed');
  });

  it('includes assistant text in session.prompt results', async () => {
    const bus = new RuntimeBus();
    let minted = '';
    const definition = def({
      sendTurn: async (input) => { minted = input.turnID; return { turnID: input.turnID }; },
    });
    bus.register(definition);
    const runtime = createNeutralRuntime(definition, { bus });

    const p = runtime.session.prompt({ sessionID: 's1', message: 'hi' } as any);
    await tick();
    bus.dispatch(adapterEvent('message.updated', {
      message: { id: 'm1', sessionID: 's1', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
    }, { turnID: minted }));
    bus.dispatch(adapterEvent('turn.completed', { ok: true }, { turnID: minted }));

    const result: any = await Promise.race([p, tick().then(() => { throw new Error('prompt did not settle'); })]);
    expect(result.text).toBe('hello');
    expect(result.parts.some((part: any) => part.type === 'text' && part.text === 'hello')).toBe(true);
  });
});

describe('busy delivery attribution', () => {
  function queuedRuntime() {
    const queue: any[] = [];
    let wake: (() => void) | undefined;
    return {
      name: 'fake',
      capabilities: {},
      session: {
        create: async () => ({ id: 's1' }),
        promptAsync: async () => {},
        abort: async () => {},
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
    } as any;
  }

  it('does not relabel a running turn when a follow-up is queued', async () => {
    const fake = queuedRuntime();
    const definition = toRuntimeDefinition(fake, { name: 'fake' });
    const seen: any[] = [];
    definition.transport.onEvent((e) => seen.push(e));

    await definition.transport.sendTurn({ sessionID: 's1', turnID: 't1', text: 'one' } as any);
    await definition.transport.sendTurn({ sessionID: 's1', turnID: 't2', text: 'two' } as any);

    fake.emit(canonical('turn.started', { sessionID: 's1', turnID: 'native-1' }));
    fake.emit(canonical('turn.completed', { sessionID: 's1', ok: true }));
    fake.emit(canonical('turn.started', { sessionID: 's1' }));
    fake.emit(canonical('turn.completed', { sessionID: 's1', ok: true }));
    await tick();

    expect(seen.filter((e) => e.type === 'turn.completed').map((e) => e.turnID)).toEqual(['t1', 't2']);
  });
});
