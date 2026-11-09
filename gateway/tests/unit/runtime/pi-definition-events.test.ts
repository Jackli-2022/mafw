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
    sendUserMessage: async () => {},
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
      // Real pi AgentEvent has no `session` field; the stream resolves the id
      // from the subscribed session object.
      for (const fn of subscribers) fn(event);
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

  it('attributes serial queued turns to their own ids', async () => {
    const harness = fakePiHarness();
    const state = await createPiState(fakeCtx(), { loadPi: async () => harness.pi });
    const seen: AdapterEvent[] = [];
    state.definition.transport.onEvent((event) => seen.push(event));

    const { sessionID } = await state.definition.transport.createSession({ directory: '/tmp/proj' });
    await state.definition.transport.sendTurn({ sessionID, turnID: 't1', text: 'one' });
    harness.emit({ type: 'agent_start' });
    harness.emit({
      type: 'agent_end',
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'reply-1' }], stopReason: 'stop' }],
    });
    await tick();

    await state.definition.transport.sendTurn({ sessionID, turnID: 't2', text: 'two' });
    harness.emit({ type: 'agent_start' });
    harness.emit({
      type: 'agent_end',
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'reply-2' }], stopReason: 'stop' }],
    });
    await tick();

    expect(seen.filter((event) => event.type === 'turn.started').map((event) => event.turnID))
      .toEqual(['t1', 't2']);
    expect(seen.filter((event) => event.type === 'turn.completed').map((event) => event.turnID))
      .toEqual(['t1', 't2']);

    await state.definition.transport.stop?.();
  });

  it('does not mint a new turn id for a steer delivered into the running loop', async () => {
    const harness = fakePiHarness();
    const state = await createPiState(fakeCtx(), { loadPi: async () => harness.pi });
    const seen: AdapterEvent[] = [];
    state.definition.transport.onEvent((event) => seen.push(event));

    const { sessionID } = await state.definition.transport.createSession({ directory: '/tmp/proj' });
    await state.definition.transport.sendTurn({ sessionID, turnID: 't1', text: 'one' });
    harness.emit({ type: 'agent_start' });

    harness.session.isStreaming = true;
    await state.definition.transport.sendTurn({ sessionID, turnID: 'steer-2', text: 'two', delivery: 'steer' });
    harness.emit({
      type: 'agent_end',
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'done' }], stopReason: 'stop' }],
    });
    await tick();

    harness.session.isStreaming = false;
    await state.definition.transport.sendTurn({ sessionID, turnID: 't3', text: 'three' });
    harness.emit({ type: 'agent_start' });
    harness.emit({
      type: 'agent_end',
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'done-3' }], stopReason: 'stop' }],
    });
    await tick();

    expect(seen.filter((event) => event.type === 'turn.completed').map((event) => event.turnID))
      .toEqual(['t1', 't3']);

    await state.definition.transport.stop?.();
  });

  it('keeps one logical turn across a pi auto-retry and ignores agent_settled', async () => {
    const harness = fakePiHarness();
    const state = await createPiState(fakeCtx(), { loadPi: async () => harness.pi });
    const seen: AdapterEvent[] = [];
    state.definition.transport.onEvent((event) => seen.push(event));

    const { sessionID } = await state.definition.transport.createSession({ directory: '/tmp/proj' });
    await state.definition.transport.sendTurn({ sessionID, turnID: 't1', text: 'hi' });

    harness.emit({ type: 'agent_start' });
    harness.emit({
      type: 'agent_end',
      willRetry: true,
      messages: [{ role: 'assistant', content: [], stopReason: 'error', errorMessage: 'rate limited' }],
    });
    harness.emit({ type: 'agent_start' });
    harness.emit({
      type: 'agent_end',
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'ok' }], stopReason: 'stop' }],
    });
    harness.emit({ type: 'agent_settled' });
    await tick();

    expect(seen.filter((event) => event.type === 'turn.failed')).toHaveLength(0);
    expect(seen.filter((event) => event.type === 'turn.completed').map((event) => event.turnID))
      .toEqual(['t1']);

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

  it('does not fail the running turn when a steer prompt rejects', async () => {
    const harness = fakePiHarness();
    const state = await createPiState(fakeCtx(), { loadPi: async () => harness.pi });
    const seen: AdapterEvent[] = [];
    state.definition.transport.onEvent((event) => seen.push(event));

    const { sessionID } = await state.definition.transport.createSession({ directory: '/tmp/proj' });
    await state.definition.transport.sendTurn({ sessionID, turnID: 't1', text: 'one' });
    harness.emit({ type: 'agent_start' });

    harness.session.isStreaming = true;
    harness.promptImpl.current = async () => { throw new Error('steer rejected'); };
    await state.definition.transport.sendTurn({ sessionID, turnID: 'steer-2', text: 'two', delivery: 'steer' });
    await tick();

    expect(seen.filter((event) => event.type === 'turn.failed')).toHaveLength(0);

    await state.definition.transport.stop?.();
  });

  it('enqueues a queue flush even while pi still reports streaming', async () => {
    const harness = fakePiHarness();
    const state = await createPiState(fakeCtx(), { loadPi: async () => harness.pi });
    const seen: AdapterEvent[] = [];
    state.definition.transport.onEvent((event) => seen.push(event));

    const { sessionID } = await state.definition.transport.createSession({ directory: '/tmp/proj' });
    await state.definition.transport.sendTurn({ sessionID, turnID: 't1', text: 'one' });
    harness.emit({ type: 'agent_start' });
    // The gateway flushes its queue inside the terminal handler, before pi has
    // flipped isStreaming to false. The next run must still get its minted id.
    harness.session.isStreaming = true;
    harness.emit({
      type: 'agent_end',
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'done' }], stopReason: 'stop' }],
    });
    await tick();
    await state.definition.transport.sendTurn({ sessionID, turnID: 't2', text: 'two' });
    harness.session.isStreaming = false;
    harness.emit({ type: 'agent_start' });
    harness.emit({
      type: 'agent_end',
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'done-2' }], stopReason: 'stop' }],
    });
    await tick();

    expect(seen.filter((event) => event.type === 'turn.completed').map((event) => event.turnID))
      .toEqual(['t1', 't2']);

    await state.definition.transport.stop?.();
  });

  it('emits turn.aborted when abort happens during retry backoff', async () => {
    const harness = fakePiHarness();
    const state = await createPiState(fakeCtx(), { loadPi: async () => harness.pi });
    const seen: AdapterEvent[] = [];
    state.definition.transport.onEvent((event) => seen.push(event));

    const { sessionID } = await state.definition.transport.createSession({ directory: '/tmp/proj' });
    await state.definition.transport.sendTurn({ sessionID, turnID: 't1', text: 'hi' });
    harness.emit({ type: 'agent_start' });
    harness.emit({
      type: 'agent_end',
      willRetry: true,
      messages: [{ role: 'assistant', content: [], stopReason: 'error', errorMessage: 'rate limited' }],
    });
    await tick();

    await state.definition.transport.interruptTurn(sessionID);
    await tick();
    expect(seen.filter((event) => event.type === 'turn.aborted').map((event) => event.turnID))
      .toEqual(['t1']);

    // A late native terminal after the synthetic abort must stay suppressed.
    harness.emit({
      type: 'agent_end',
      messages: [{ role: 'assistant', content: [], stopReason: 'aborted' }],
    });
    await tick();
    expect(seen.filter((event) => event.type === 'turn.aborted')).toHaveLength(1);

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
