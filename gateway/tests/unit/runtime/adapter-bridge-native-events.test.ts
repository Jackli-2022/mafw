import { toRuntimeDefinition } from '../../../src/runtime/adapter-bridge';

function nativeRuntime() {
  const queue: any[] = [];
  let wake: (() => void) | undefined;
  return {
    name: 'pi',
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
  } as any;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
let seq = 0;
const event = (type: string, extra: any = {}) => ({
  id: `e_${type}_${++seq}`,
  type,
  at: Date.now(),
  data: {},
  ...extra,
});

it('forwards AdapterEvents and fills the minted turn id', async () => {
  const runtime = nativeRuntime();
  const def = toRuntimeDefinition(runtime, { name: 'pi', nativeEvents: true });
  const seen: any[] = [];
  def.transport.onEvent((e) => seen.push(e));
  await tick();

  await def.transport.sendTurn({ sessionID: 's1', turnID: 't1', text: 'hi' } as any);
  runtime.emit(event('turn.started', { sessionID: 's1' }));
  runtime.emit(event('tool.call', { sessionID: 's1', data: { callID: 'c1', name: 'bash', input: {} } }));
  runtime.emit(event('message.updated', { sessionID: 's1', data: { message: { id: 'm1', role: 'assistant', content: [] } } }));
  runtime.emit(event('turn.completed', { sessionID: 's1', data: { ok: true } }));
  await tick();

  expect(seen.map((e) => e.type)).toEqual(['turn.started', 'tool.call', 'message.updated', 'turn.completed']);
  expect(seen.every((e) => e.turnID === 't1')).toBe(true);
});

it('drops invalid native events instead of forwarding them', async () => {
  const runtime = nativeRuntime();
  const def = toRuntimeDefinition(runtime, { name: 'pi', nativeEvents: true });
  const seen: any[] = [];
  def.transport.onEvent((e) => seen.push(e));
  await tick();

  await def.transport.sendTurn({ sessionID: 's1', turnID: 't1', text: 'hi' } as any);
  runtime.emit({ type: 'turn.started' });
  runtime.emit(event('turn.completed', { sessionID: 's1', data: { ok: true } }));
  await tick();

  expect(seen.map((e) => e.type)).toEqual(['turn.completed']);
  expect(seen[0].turnID).toBe('t1');
});

it('keeps the aborted terminal after interruptTurn', async () => {
  const runtime = nativeRuntime();
  const def = toRuntimeDefinition(runtime, { name: 'pi', nativeEvents: true });
  const seen: any[] = [];
  def.transport.onEvent((e) => seen.push(e));
  await tick();

  await def.transport.sendTurn({ sessionID: 's1', turnID: 't1', text: 'hi' } as any);
  runtime.emit(event('turn.started', { sessionID: 's1' }));
  runtime.emit(event('tool.call', { sessionID: 's1', data: { callID: 'c1', name: 'bash', input: {} } }));
  await def.transport.interruptTurn('s1');
  runtime.emit(event('turn.aborted', { sessionID: 's1', data: { reason: 'aborted' } }));
  await tick();

  expect(seen.map((e) => e.type)).toEqual(['turn.started', 'tool.call', 'turn.aborted']);
  expect(seen.every((e) => e.turnID === 't1')).toBe(true);
});

it('does not attach an aborted turn to a queued follow-up', async () => {
  const runtime = nativeRuntime();
  const def = toRuntimeDefinition(runtime, { name: 'pi', nativeEvents: true });
  const seen: any[] = [];
  def.transport.onEvent((e) => seen.push(e));
  await tick();

  await def.transport.sendTurn({ sessionID: 's1', turnID: 't1', text: 'one' } as any);
  runtime.emit(event('turn.started', { sessionID: 's1' }));
  await def.transport.interruptTurn('s1');
  await def.transport.sendTurn({ sessionID: 's1', turnID: 't2', text: 'two' } as any);
  runtime.emit(event('turn.aborted', { sessionID: 's1', data: { reason: 'aborted' } }));
  runtime.emit(event('turn.started', { sessionID: 's1' }));
  runtime.emit(event('tool.call', { sessionID: 's1', data: { callID: 'c2', name: 'bash', input: {} } }));
  runtime.emit(event('turn.completed', { sessionID: 's1', data: { ok: true } }));
  await tick();

  expect(seen.map((e) => `${e.type}:${e.turnID}`)).toEqual([
    'turn.started:t1',
    'turn.aborted:t1',
    'turn.started:t2',
    'tool.call:t2',
    'turn.completed:t2',
  ]);
});

it('consumes one queued turn per terminal when there is no turn.started', async () => {
  const runtime = nativeRuntime();
  const def = toRuntimeDefinition(runtime, { name: 'pi', nativeEvents: true });
  const seen: any[] = [];
  def.transport.onEvent((e) => seen.push(e));
  await tick();

  await def.transport.sendTurn({ sessionID: 's1', turnID: 't1', text: 'one' } as any);
  await def.transport.sendTurn({ sessionID: 's1', turnID: 't2', text: 'two' } as any);
  runtime.emit(event('turn.completed', { sessionID: 's1', data: { ok: true } }));
  runtime.emit(event('turn.completed', { sessionID: 's1', data: { ok: true } }));
  await tick();

  expect(seen.map((e) => e.turnID)).toEqual(['t1', 't2']);
});

it('mints a turn id for an extension-initiated run', async () => {
  const runtime = nativeRuntime();
  const def = toRuntimeDefinition(runtime, { name: 'pi', nativeEvents: true });
  const seen: any[] = [];
  def.transport.onEvent((e) => seen.push(e));
  await tick();

  runtime.emit(event('turn.started', { sessionID: 's1' }));
  runtime.emit(event('tool.call', { sessionID: 's1', data: { callID: 'c1', name: 'bash', input: {} } }));
  runtime.emit(event('turn.completed', { sessionID: 's1', data: { ok: true } }));
  await tick();

  expect(seen).toHaveLength(3);
  const id = seen[0].turnID;
  expect(id).toMatch(/^bridge-s1-/);
  expect(seen.every((e) => e.turnID === id)).toBe(true);
});

it('rejects nativeEvents combined with translate', () => {
  expect(() => toRuntimeDefinition(nativeRuntime(), {
    name: 'pi',
    nativeEvents: true,
    translate: { entry: { eventMappings: [] }, isCanonical: () => true },
  })).toThrow(/mutually exclusive/);
});
