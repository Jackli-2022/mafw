import { defineRuntime, type RuntimeDefinition, type RuntimeTransport } from '@mafw/runtime-contract';
import { RuntimeBus } from '../../../src/runtime/runtime-bus';
import { createNeutralRuntime } from '../../../src/runtime/neutral-runtime';

function defWith(overrides: Partial<RuntimeTransport>, extra: Partial<RuntimeDefinition> = {}): RuntimeDefinition {
  const transport: RuntimeTransport = {
    createSession: async () => ({ sessionID: 's1' }),
    sendTurn: async (input) => ({ turnID: input.turnID }),
    interruptTurn: async () => {},
    onEvent: () => () => {},
    ...overrides,
  };
  return defineRuntime({
    api: 1,
    name: 'fake',
    displayName: 'Fake',
    preset: 'core',
    transport,
    ...extra,
  } as any);
}

/** A bus that already has `fake` registered, so dispatch() targets it by default. */
function newBus(): RuntimeBus {
  const bus = new RuntimeBus();
  bus.register(defWith({}));
  return bus;
}

let seq = 0;
function adapterEvent(type: string, data: any, extra: any = {}) {
  seq += 1;
  return { id: `e-${seq}`, type, sessionID: 's1', at: Date.now(), data, ...extra } as any;
}

function firstEvent(runtime: any): Promise<any> {
  return (async () => {
    const result: any = await runtime.global.event();
    for await (const evt of result.stream) return evt;
  })();
}

it('routes promptAsync through transport.sendTurn with a minted turn id', async () => {
  const sent: any[] = [];
  const rt = createNeutralRuntime(
    defWith({ sendTurn: async (input) => { sent.push(input); return { turnID: input.turnID }; } }),
    { bus: newBus() },
  );
  await rt.session.promptAsync({ sessionID: 's1', message: 'hi', delivery: 'followup' } as any);
  expect(sent[0].text).toBe('hi');
  expect(sent[0].turnID).toMatch(/^turn_/);
  expect(sent[0].delivery).toBe('followup');
});

it('does not expose channels the runtime lacks', () => {
  const rt = createNeutralRuntime(defWith({}), { bus: newBus() });
  expect((rt.session as any).todo).toBeUndefined();
  expect((rt as any).mcp).toBeUndefined();
});

it('fans out bus events to every global.event consumer', async () => {
  const bus = newBus();
  const rt = createNeutralRuntime(defWith({}), { bus });

  const a = firstEvent(rt);
  const b = firstEvent(rt);
  await new Promise((r) => setTimeout(r, 10));
  bus.dispatch(adapterEvent('turn.completed', { ok: true }, { turnID: 't1' }));

  expect((await a).payload.type).toBe('turn.completed');
  expect((await b).payload.type).toBe('turn.completed');
});

it('ignores events from another runtime', async () => {
  const bus = newBus();
  const other = defineRuntime({
    api: 1, name: 'other', displayName: 'Other', preset: 'core',
    transport: {
      createSession: async () => ({ sessionID: 's2' }),
      sendTurn: async (i) => ({ turnID: i.turnID }),
      interruptTurn: async () => {},
      onEvent: () => () => {},
    },
  });
  bus.register(other as any);
  const rt = createNeutralRuntime(defWith({}), { bus, });

  const pending = firstEvent(rt);
  await new Promise((r) => setTimeout(r, 10));
  bus.dispatch(adapterEvent('turn.completed', { ok: true }, { turnID: 't-other', sessionID: 's2' }), 'other');
  bus.dispatch(adapterEvent('turn.completed', { ok: true }, { turnID: 't-fake' }), 'fake');

  const got = await pending;
  expect(got.payload.type).toBe('turn.completed');
  expect(got.payload.properties.turnID).toBe('t-fake');
});

it('resolves session.prompt when the turn completes', async () => {
  const bus = newBus();
  let minted = '';
  const rt = createNeutralRuntime(
    defWith({ sendTurn: async (input) => { minted = input.turnID; return { turnID: input.turnID }; } }),
    { bus },
  );
  const p = rt.session.prompt({ sessionID: 's1', message: 'hi' } as any);
  await new Promise((r) => setTimeout(r, 10));
  bus.dispatch(adapterEvent('turn.completed', { ok: true, usage: { input: 1, output: 2 } }, { turnID: minted }));
  const result: any = await p;
  expect(result.usage).toEqual({ input: 1, output: 2 });
});

it('maps permissionReply always to allow+always', async () => {
  const calls: any[] = [];
  const rt = createNeutralRuntime(
    defWith({ respondToRequest: async (...args: any[]) => { calls.push(args); return 'allowed-once'; } }),
    { bus: newBus() },
  );
  const ok = await rt.session.permissionReply!('s1', 'r1', 'always');
  expect(calls[0][2]).toEqual({ behavior: 'allow', always: true });
  expect(ok).toBe(true);
});

it('maps reject to a deny decision', async () => {
  const calls: any[] = [];
  const rt = createNeutralRuntime(
    defWith({ respondToRequest: async (...args: any[]) => { calls.push(args); return 'rejected'; } }),
    { bus: newBus() },
  );
  const ok = await rt.session.permissionReply!('s1', 'r1', 'reject', 'no');
  expect(calls[0][2]).toEqual({ behavior: 'deny', message: 'no' });
  expect(ok).toBe(false);
});

it('dispose stops the transport', async () => {
  let stopped = 0;
  const rt = createNeutralRuntime(defWith({ stop: async () => { stopped += 1; } }), { bus: newBus() });
  await rt.dispose!();
  expect(stopped).toBe(1);
});
