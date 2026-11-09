import { RuntimeBus } from '../../../src/runtime/runtime-bus';

function fakeDef(onEvent: (l: any) => () => void) {
  return {
    api: 1, eventApi: 1, name: 'fake', displayName: 'Fake', preset: 'core',
    transport: {
      createSession: async () => ({ sessionID: 's1' }),
      sendTurn: async () => ({ turnID: 't1' }),
      interruptTurn: async () => {},
      onEvent,
    },
    capabilities: {},
  } as any;
}

it('stamps runtime name and delivers mapped events', () => {
  const bus = new RuntimeBus();
  const seen: any[] = [];
  bus.subscribe((m) => seen.push(m));
  bus.register(fakeDef(() => () => {}));
  bus.dispatch({ id: 'e1', type: 'turn.started', sessionID: 's1', turnID: 't1', at: 1, data: {} } as any);
  expect(seen[0].runtimeName).toBe('fake');
  expect(seen[0].canonical.payload.type).toBe('turn.started');
});

it('drops duplicate ids', () => {
  const bus = new RuntimeBus();
  bus.register(fakeDef(() => () => {}));
  const e = { id: 'e1', type: 'turn.started', sessionID: 's1', turnID: 't1', at: 1, data: {} } as any;
  bus.dispatch(e); bus.dispatch(e);
  expect(bus.stats().duplicate).toBe(1);
});

it('drops unknown types', () => {
  const bus = new RuntimeBus();
  bus.register(fakeDef(() => () => {}));
  bus.dispatch({ id: 'e1', type: 'nope', sessionID: 's1', at: 1, data: {} } as any);
  expect(bus.stats().unknown).toBe(1);
});

it('drops events from a retired turn', () => {
  const bus = new RuntimeBus();
  const seen: any[] = [];
  bus.subscribe((m) => seen.push(m));
  bus.register(fakeDef(() => () => {}));
  bus.dispatch({ id: 'e1', type: 'turn.completed', sessionID: 's1', turnID: 't1', at: 1, data: { ok: true } } as any);
  bus.dispatch({ id: 'e2', type: 'turn.completed', sessionID: 's1', turnID: 't1', at: 2, data: { ok: true } } as any);
  expect(seen.filter((m) => m.canonical?.payload.type === 'turn.completed')).toHaveLength(1);
});

it('drops out-of-order seq and malformed envelopes', () => {
  const bus = new RuntimeBus();
  bus.register(fakeDef(() => () => {}));
  bus.dispatch({ id: 'e1', type: 'turn.started', sessionID: 's1', turnID: 't1', at: 1, seq: 2, data: {} } as any);
  bus.dispatch({ id: 'e2', type: 'part.delta', sessionID: 's1', turnID: 't1', at: 2, seq: 1, data: { delta: 'old' } } as any);
  bus.dispatch({ id: 'e3', type: 'part.delta', sessionID: 's1', at: 3, data: null } as any);
  expect(bus.stats().stale).toBe(1);
  expect(bus.stats().dropped).toBe(1);
});
