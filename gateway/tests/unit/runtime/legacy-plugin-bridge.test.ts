import { toRuntimeDefinition } from '../../../src/runtime/legacy/legacy-plugin-bridge';

function legacy() {
  const listeners = new Set<(e: any) => void>();
  return {
    name: 'old',
    session: {
      create: async () => ({ id: 's1' }),
      promptAsync: async () => {},
      abort: async () => {},
      messages: async () => ({ data: [] }),
    },
    global: { event: async () => ({ stream: (async function* () {})() }) },
    tools: { registerTools() {}, nativeTools: () => [] },
    onEvent(listener: any) { listeners.add(listener); return () => listeners.delete(listener); },
    emit(e: any) { for (const l of listeners) l(e); },
  } as any;
}

it('wraps a legacy runtime and converts core canonical events', () => {
  const old = legacy();
  const def = toRuntimeDefinition(old, { name: 'old' });
  const got: any[] = [];
  def.transport.onEvent((e) => got.push(e));
  old.emit({ payload: { type: 'turn.completed', properties: { sessionID: 's1', turnID: 't1' } } });
  expect(got[0].type).toBe('turn.completed');
  expect(got[0].data).toBeDefined();
});

it('exposes legacy channels it has, unsupported otherwise', async () => {
  const def = toRuntimeDefinition(legacy(), { name: 'old' });
  expect(await def.channels?.messages?.list('s1')).toEqual({ data: [] });
  expect(def.channels?.branch).toBeUndefined();
});
