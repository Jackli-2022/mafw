import { validateAdapterEvent } from '@mafw/runtime-contract';
import { mapAdapterEvent } from '../../../src/runtime/adapter-event-mapper';
import { canonicalToAdapterEvent, toRuntimeDefinition } from '../../../src/runtime/adapter-bridge';

function canonical(type: string, properties: Record<string, unknown> = {}): any {
  return { payload: { type, properties }, sessionID: 's1' };
}

/** Every canonical type a runtime can emit through the gateway pipeline. */
const RUNTIME_CANONICAL_EVENTS: Array<[string, Record<string, unknown>]> = [
  ['session.created', { info: { id: 's1', title: 't' } }],
  ['session.updated', { info: { id: 's1', title: 't2' } }],
  ['session.deleted', {}],
  ['session.compacting', {}],
  ['session.compacted', {}],
  ['turn.started', { turnID: 't1' }],
  ['turn.completed', { turnID: 't1', ok: true, usage: { input: 1, output: 2 } }],
  ['turn.failed', { turnID: 't1', error: 'boom' }],
  ['turn.aborted', { turnID: 't1' }],
  ['message.updated', { message: { id: 'm1', sessionID: 's1', role: 'assistant' } }],
  ['message.removed', { messageID: 'm1' }],
  ['part.updated', { part: { id: 'p1', sessionID: 's1', messageID: 'm1', type: 'text', text: 'hi' } }],
  ['part.delta', { messageID: 'm1', partID: 'p1', field: 'text', delta: 'x' }],
  ['part.complete', { part: { id: 'p1', sessionID: 's1', messageID: 'm1', type: 'text', text: 'hi' } }],
  ['part.removed', { partID: 'p1' }],
  ['permission.asked', { id: 'r1', sessionID: 's1', permission: 'bash' }],
  ['permission.replied', { sessionID: 's1', requestId: 'r1', reply: 'once' }],
  ['question.asked', { id: 'q1', sessionID: 's1', questions: [] }],
  ['question.replied', { sessionID: 's1', requestId: 'q1', answers: [['a']] }],
  ['question.rejected', { sessionID: 's1', requestId: 'q1' }],
  ['plan.updated', { todos: [] }],
  ['usage.updated', { turnID: 't1', usage: { input: 1 } }],
  ['tool.call', { callID: 'c1', tool: 'bash', input: {} }],
  ['tool.delta', { callID: 'c1', kind: 'input', text: 'x' }],
  ['tool.result', { callID: 'c1', output: 'ok', isError: false }],
];

describe('adapter bridge round-trip', () => {
  it.each(RUNTIME_CANONICAL_EVENTS)('round-trips %s', (type, properties) => {
    const adapter = canonicalToAdapterEvent(canonical(type, properties));
    expect(adapter).not.toBeNull();
    expect(validateAdapterEvent(adapter).ok).toBe(true);
    const mapped = mapAdapterEvent(adapter!);
    expect(mapped.dropped).toBeUndefined();
    const back = mapped.canonical?.payload.type ?? mapped.internal?.type;
    expect(back).toBe(type);
  });

  it('keeps ids and deltas through the round-trip', () => {
    const source = canonical('part.delta', { messageID: 'm1', partID: 'p1', field: 'text', delta: 'x' });
    const back = mapAdapterEvent(canonicalToAdapterEvent(source)!).canonical!;
    expect(back.payload.properties).toMatchObject({ messageID: 'm1', partID: 'p1', field: 'text', delta: 'x' });
  });

  it('keeps the turn terminal usage', () => {
    const source = canonical('turn.completed', { turnID: 't1', ok: true, usage: { input: 1, output: 2 } });
    const adapter = canonicalToAdapterEvent(source)!;
    expect(adapter.turnID).toBe('t1');
    expect((adapter.data as any).usage).toEqual({ input: 1, output: 2 });
  });
});

describe('toRuntimeDefinition', () => {
  function legacyRuntime() {
    const listeners = new Set<(evt: any) => void>();
    return {
      name: 'old',
      capabilities: { sessionApi: true },
      session: {
        create: async () => ({ id: 's1' }),
        promptAsync: async () => {},
        abort: async () => {},
        messages: async () => ({ data: [] }),
        list: async () => [],
      },
      global: { event: async () => ({ stream: (async function* () {})() }) },
      tools: { registerTools() {}, nativeTools: () => [] },
      onEvent(listener: (evt: any) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      emit(evt: any) {
        for (const listener of listeners) listener(evt);
      },
    } as any;
  }

  it('exposes a definition with name, capabilities and external flag', async () => {
    const rt = legacyRuntime();
    const def = toRuntimeDefinition(rt, { name: 'old', capabilities: { sessionApi: true }, external: true });
    expect(def.name).toBe('old');
    expect(def.external).toBe(true);
    expect(def.capabilities.sessionApi).toBe(true);
    expect(typeof def.transport.onEvent).toBe('function');
  });

  it('applies a dialect translation before reverse-mapping when asked', async () => {
    const rt = legacyRuntime();
    const def = toRuntimeDefinition(rt, {
      name: 'old',
      translate: {
        entry: {
          eventSource: { typePath: '$.payload.type', sessionIdPath: '$.payload.properties.sessionID' },
          eventMappings: [{ from: 'raw.done', to: 'turn.completed', fields: { ok: { const: true } } }],
        },
        isCanonical: (t) => t === 'turn.completed',
      },
    });
    const seen: any[] = [];
    def.transport.onEvent((e) => seen.push(e));
    rt.emit({ payload: { type: 'raw.done', properties: { sessionID: 's1', turnID: 't1' } } });
    expect(seen[0].type).toBe('turn.completed');
    expect(seen[0].turnID).toMatch(/^bridge-s1-/);
  });
});
