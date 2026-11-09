import { readFileSync } from 'fs';
import { join } from 'path';
import { RuntimeBus } from '../../../src/runtime/runtime-bus';
import { toRuntimeDefinition } from '../../../src/runtime/adapter-bridge';
import { applyEventMappings } from '../../../src/runtime/event-mapper';
import { EVENT_FLOW_MATRIX } from '../../../src/runtime/event-flow-matrix';
import { OPENCODE_EVENT_SOURCE, OPENCODE_V1_EVENT_MAPPINGS, OPENCODE_TRANSFORM_EVENT } from '../../../src/runtime/opencode-events';

const ENTRY = {
  eventSource: OPENCODE_EVENT_SOURCE,
  eventMappings: OPENCODE_V1_EVENT_MAPPINGS,
  transformEvent: OPENCODE_TRANSFORM_EVENT,
};

const RAW = readFileSync(join(__dirname, '../../fixtures/events/runtime-raw-session.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));

const legacy = RAW.flatMap((event) => applyEventMappings(event, ENTRY, (type) => !!EVENT_FLOW_MATRIX[type]));

function fakeRuntime(raw: any[]) {
  return {
    name: 'opencode',
    capabilities: {},
    session: {
      create: async () => ({ id: 's1' }),
      promptAsync: async () => {},
      abort: async () => {},
    },
    global: {
      event: async () => ({
        stream: (async function* () {
          for (const event of raw) yield event;
        })(),
      }),
    },
    tools: { registerTools() {}, nativeTools: () => [] },
  } as any;
}

it('opencode neutral path reproduces the translated canonical sequence', async () => {
  const bus = new RuntimeBus();
  const definition = toRuntimeDefinition(fakeRuntime(RAW), {
    name: 'opencode',
    capabilities: {},
    translate: { entry: ENTRY, isCanonical: (type) => !!EVENT_FLOW_MATRIX[type] },
  });
  bus.register(definition);

  const seen: any[] = [];
  bus.subscribe((delivered) => {
    if (delivered.canonical) seen.push(delivered.canonical);
  });

  const started = Date.now();
  while (seen.length < legacy.length && Date.now() - started < 2000) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  expect(seen.map((event) => event.payload.type)).toEqual(legacy.map((event: any) => event.payload.type));

  // The bridge re-attaches the top-level sessionID (additive); compare the
  // semantic owner instead of the envelope shape.
  const owner = (event: any) => event.sessionID
    ?? event.payload?.properties?.sessionID
    ?? event.payload?.properties?.part?.sessionID
    ?? event.payload?.properties?.message?.sessionID;
  expect(seen.map(owner)).toEqual(legacy.map(owner));
});
