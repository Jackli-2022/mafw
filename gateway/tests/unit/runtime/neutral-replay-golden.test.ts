import { RuntimeBus } from '../../../src/runtime/runtime-bus';
import { toRuntimeDefinition } from '../../../src/runtime/adapter-bridge';
import { translatePiEvent } from '../../fixtures/pi-canonical-events';
import { PI_CAPABILITIES } from '../../../../adapters/pi/src/runtime';

const SESSION = 'pi_golden';

/** A realistic pi turn: start → message → tool → step end → agent end. */
const PI_RAW = [
  { type: 'agent_start' },
  { type: 'message_start', role: 'assistant', timestamp: 1_700_000_000_000, contentIndex: 0 },
  { type: 'message_update', delta: 'thinking', assistantMessageEvent: { type: 'thinking_delta', delta: 'hm' }, timestamp: 1_700_000_000_001, contentIndex: 0 },
  { type: 'message_update', delta: 'hi', assistantMessageEvent: { type: 'text_delta', delta: 'hi' }, timestamp: 1_700_000_000_002, contentIndex: 1 },
  { type: 'message_end', role: 'assistant', timestamp: 1_700_000_000_003 },
  { type: 'tool_execution_start', toolCallId: 'tc1', toolName: 'bash', args: { command: 'ls' } },
  { type: 'tool_execution_end', toolCallId: 'tc1', toolName: 'bash', result: { content: [{ type: 'text', text: 'ok' }] }, isError: false },
  { type: 'turn_end' },
  { type: 'agent_end' },
];

/**
 * Legacy bridge seam: the fake runtime yields canonical events. The real pi
 * adapter now emits AdapterEvent natively (pi-adapter-events); this fixture
 * keeps the old declared-mapping path pinned by pi-events.test.ts.
 */
function fakeRuntime(canonical: any[]) {
  return {
    name: 'pi',
    capabilities: PI_CAPABILITIES,
    external: false,
    session: {
      create: async () => ({ id: SESSION }),
      promptAsync: async () => {},
      abort: async () => {},
    },
    global: {
      event: async () => ({
        stream: (async function* () {
          for (const evt of canonical) yield evt;
        })(),
      }),
    },
    tools: { registerTools() {}, nativeTools: () => [] },
  } as any;
}

it('pi neutral path reproduces the canonical sequence without loss', async () => {
  const legacy = PI_RAW
    .flatMap((e) => translatePiEvent(e as any, SESSION) ?? [])
    .filter((e: any) => e?.payload?.type);

  const bus = new RuntimeBus();
  const def = toRuntimeDefinition(fakeRuntime(legacy), {
    name: 'pi',
    capabilities: PI_CAPABILITIES as unknown as Record<string, unknown>,
    external: false,
  });
  bus.register(def);

  const seen: any[] = [];
  bus.subscribe((delivered) => {
    if (delivered.canonical) seen.push(delivered.canonical);
  });

  const started = Date.now();
  while (seen.length < legacy.length && Date.now() - started < 2000) {
    await new Promise((r) => setTimeout(r, 5));
  }

  expect(seen.map((e) => e.payload.type)).toEqual(legacy.map((e: any) => e.payload.type));

  // Payload fidelity: part/message ids survive canonical → AdapterEvent → canonical.
  const partIds = (list: any[]) => list
    .filter((e) => e.payload.type === 'part.updated' && e.payload.properties?.part?.id)
    .map((e) => e.payload.properties.part.id);
  expect(partIds(seen)).toEqual(partIds(legacy));
});
