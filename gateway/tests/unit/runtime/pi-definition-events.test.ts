import { createPiState } from '../../../../adapters/pi/src/runtime';
import type { AdapterEvent } from '@mafw/runtime-contract';
import type { RuntimePluginContext } from '../../../src/runtime/loader';
import { RuntimeBus } from '../../../src/runtime/runtime-bus';

const tick = () => new Promise((r) => setTimeout(r, 20));

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

interface FakePiHarness {
  pi: any;
  session: any;
  emit(event: Record<string, unknown>): void;
  promptImpl: { current: () => Promise<void> };
}

function fakePiHarness(): FakePiHarness {
  const subscribers: Array<(event: any) => void> = [];
  const promptImpl = {
    current: () => new Promise<void>(() => { /* never resolves: sendTurn must not wait */ }),
  };
  const session: any = {
    prompt: (_text: string) => promptImpl.current(),
    waitForIdle: async () => {},
    abort: async () => {},
    dispose: async () => {},
    compact: async () => ({}),
    subscribe: (fn: (event: any) => void) => {
      subscribers.push(fn);
      return () => {};
    },
    isStreaming: false,
    messages: [],
    setSessionName: () => {},
  };
  const pi = {
    ModelRuntime: {
      create: async () => ({
        getModel: () => ({ id: 'xiaomi/mimo' }),
        getProviders: () => [{ id: 'xiaomi', name: 'Xiaomi' }],
        getModels: () => [{ id: 'mimo' }],
        hasConfiguredAuth: () => true,
        setRuntimeApiKey: async () => {},
      }),
    },
    createAgentSession: async () => ({ session }),
  };
  return {
    pi,
    session,
    promptImpl,
    emit: (event) => {
      for (const fn of subscribers) fn({ ...event, session });
    },
  };
}

describe('pi definition event path', () => {
  it('sendTurn resolves before the turn finishes and echoes the minted turnID', async () => {
    const harness = fakePiHarness();
    const state = await createPiState(fakeCtx(), { loadPi: async () => harness.pi });
    const seen: AdapterEvent[] = [];
    state.definition.transport.onEvent((event) => seen.push(event));

    const { sessionID } = await state.definition.transport.createSession({ directory: '/tmp/proj' });
    const result = await state.definition.transport.sendTurn({ sessionID, turnID: 't1', text: 'hi' });
    expect(result).toEqual({ turnID: 't1' });

    harness.emit({ type: 'agent_start' });
    await tick();
    expect(seen.find((event) => event.type === 'turn.started')?.turnID).toBe('t1');

    harness.emit({
      type: 'agent_end',
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'ok' }], stopReason: 'stop' }],
    });
    await tick();
    const completed = seen.find((event) => event.type === 'turn.completed');
    expect(completed?.turnID).toBe('t1');
    expect(completed?.data).toMatchObject({ ok: true });

    await state.definition.transport.stop?.();
  });

  it('attributes queued follow-ups to their own turn ids', async () => {
    const harness = fakePiHarness();
    const state = await createPiState(fakeCtx(), { loadPi: async () => harness.pi });
    const seen: AdapterEvent[] = [];
    state.definition.transport.onEvent((event) => seen.push(event));

    const { sessionID } = await state.definition.transport.createSession({ directory: '/tmp/proj' });
    await state.definition.transport.sendTurn({ sessionID, turnID: 't1', text: 'one' });
    await state.definition.transport.sendTurn({ sessionID, turnID: 't2', text: 'two' });

    for (let i = 0; i < 2; i += 1) {
      harness.emit({ type: 'agent_start' });
      harness.emit({
        type: 'agent_end',
        messages: [{ role: 'assistant', content: [{ type: 'text', text: `reply-${i}` }], stopReason: 'stop' }],
      });
    }
    await tick();

    expect(seen.filter((event) => event.type === 'turn.started').map((event) => event.turnID))
      .toEqual(['t1', 't2']);
    expect(seen.filter((event) => event.type === 'turn.completed').map((event) => event.turnID))
      .toEqual(['t1', 't2']);

    await state.definition.transport.stop?.();
  });

  it('turn frames survive RuntimeBus validation with the gateway-minted id', async () => {
    const harness = fakePiHarness();
    const state = await createPiState(fakeCtx(), { loadPi: async () => harness.pi });
    const bus = new RuntimeBus();
    bus.register(state.definition);
    const seen: any[] = [];
    bus.subscribe((event) => seen.push(event));

    const { sessionID } = await state.definition.transport.createSession({ directory: '/tmp/proj' });
    await state.definition.transport.sendTurn({ sessionID, turnID: 't1', text: 'hi' });
    harness.emit({ type: 'agent_start' });
    harness.emit({
      type: 'agent_end',
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'ok' }], stopReason: 'stop' }],
    });
    await tick();

    const types = seen.map((event) => event.canonical?.payload?.type ?? event.canonical?.type);
    expect(types).toContain('turn.started');
    expect(types).toContain('turn.completed');
    expect(seen.filter((event) => (event.canonical?.payload?.type ?? event.canonical?.type)?.startsWith('turn.'))
      .map((event) => (event.canonical as any)?.properties?.turnID
        ?? (event.canonical as any)?.payload?.properties?.turnID))
      .toEqual(['t1', 't1']);
    expect(bus.stats()).toMatchObject({ unknown: 0, dropped: 0 });

    bus.unregister('pi');
    await state.definition.transport.stop?.();
  });

  it('surfaces a rejected prompt as turn.failed with the minted id', async () => {
    const harness = fakePiHarness();
    harness.promptImpl.current = async () => {
      throw new Error('provider exploded');
    };
    const state = await createPiState(fakeCtx(), { loadPi: async () => harness.pi });
    const seen: AdapterEvent[] = [];
    state.definition.transport.onEvent((event) => seen.push(event));

    const { sessionID } = await state.definition.transport.createSession({ directory: '/tmp/proj' });
    await state.definition.transport.sendTurn({ sessionID, turnID: 't1', text: 'hi' });
    await tick();

    const failed = seen.find((event) => event.type === 'turn.failed');
    expect(failed?.turnID).toBe('t1');
    expect(String((failed?.data as any)?.error?.message)).toContain('provider exploded');

    await state.definition.transport.stop?.();
  });
});
