import { validateAdapterEvent } from '@mafw/runtime-contract';
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

it('reads session id from info.id and synthesizes a turn id when missing', () => {
  const old = legacy();
  const def = toRuntimeDefinition(old, { name: 'old' });
  const got: any[] = [];
  def.transport.onEvent((e) => got.push(e));
  old.emit({ payload: { type: 'session.created', properties: { info: { id: 's1' } } } });
  old.emit({ payload: { type: 'turn.completed', properties: { sessionID: 's1' } } });
  expect(got[0].type).toBe('session.created');
  expect(got[0].sessionID).toBe('s1');
  expect(validateAdapterEvent(got[0]).ok).toBe(true);
  expect(got[1].type).toBe('turn.completed');
  expect(got[1].turnID).toMatch(/^bridge-s1-/);
  expect(validateAdapterEvent(got[1]).ok).toBe(true);
});

it('maps tools and module capabilities through the bridge', async () => {
  const old = legacy();
  old.tools = { registerTools: () => {}, nativeTools: () => [{ name: 'Bash' }] };
  const def = toRuntimeDefinition(old, { name: 'old', capabilities: { promptWhileBusy: true } });
  expect(typeof def.channels?.tools?.registerTools).toBe('function');
  expect(def.capabilities.promptWhileBusy).toBe(true);
});
