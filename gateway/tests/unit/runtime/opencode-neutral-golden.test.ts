import { readFileSync } from 'fs';
import { join } from 'path';
import { RuntimeBus } from '../../../src/runtime/runtime-bus';
import { toRuntimeDefinition as gatewayToRuntimeDefinition } from '../../../src/runtime/adapter-bridge';
import { toRuntimeDefinition } from '../../../../adapters/opencode/src/legacy-definition';
import { applyEventMappings } from '../../../src/runtime/event-mapper';
import { EVENT_FLOW_MATRIX } from '../../../src/runtime/event-flow-matrix';
import { OPENCODE_EVENT_SOURCE, OPENCODE_V1_EVENT_MAPPINGS, OPENCODE_TRANSFORM_EVENT } from '../../../../adapters/opencode/src/events';
import { OPENCODE_21_EVENT_MAPPINGS, OPENCODE_21_EVENT_SOURCE, translateOpencode21Event } from '../../../../adapters/opencode/src/events-21';

const ENTRY = {
  eventSource: OPENCODE_EVENT_SOURCE,
  eventMappings: OPENCODE_V1_EVENT_MAPPINGS,
  transformEvent: OPENCODE_TRANSFORM_EVENT,
};

/** opencode 2.1 dialect: top-level `{ type, data }` envelope. */
const V21_ENTRY = {
  eventSource: OPENCODE_21_EVENT_SOURCE,
  eventMappings: OPENCODE_21_EVENT_MAPPINGS,
  transformEvent: translateOpencode21Event,
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

/** Semantic owner of a delivered event: the bridge re-attaches the top-level sessionID. */
function semanticOwner(event: any) {
  return event.sessionID
    ?? event.payload?.properties?.sessionID
    ?? event.payload?.properties?.part?.sessionID
    ?? event.payload?.properties?.message?.sessionID;
}

async function collectCanonical(definition: any, expected: number): Promise<any[]> {
  const bus = new RuntimeBus();
  bus.register(definition);
  const seen: any[] = [];
  bus.subscribe((delivered) => {
    if (delivered.canonical) seen.push(delivered.canonical);
  });
  const started = Date.now();
  while (seen.length < expected && Date.now() - started < 2000) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return seen;
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

/** opencode 2.1 raw events that have no AdapterEvent home until Task 1. */
const V21_RAW = [
  {
    id: 'v1', created: 1, type: 'session.created',
    data: { sessionID: 's21', slug: 'quiet' }, location: { directory: '/p' },
  },
  {
    id: 'v2', created: 2, type: 'session.inbox.enqueued',
    data: { sessionID: 's21', item: { id: 'q1', text: 'later' } }, location: { directory: '/p' },
  },
  {
    id: 'v3', created: 3, type: 'session.next.synthetic',
    data: { sessionID: 's21', metadata: { source: 'shell', shellID: 'sh_1', status: 'completed', exitCode: 0 } },
    location: { directory: '/p' },
  },
  {
    id: 'v4', created: 4, type: 'session.diff',
    data: { sessionID: 's21', diff: [{ file: 'a.ts' }] }, location: { directory: '/p' },
  },
];

it('opencode @2.1 created/queue/background/diff survive the neutral round-trip (no drops)', async () => {
  const bus = new RuntimeBus();
  const definition = toRuntimeDefinition(fakeRuntime(V21_RAW), {
    name: 'opencode-21',
    capabilities: {},
    translate: { entry: V21_ENTRY, isCanonical: (type) => !!EVENT_FLOW_MATRIX[type] },
  });
  const adapterEvents: any[] = [];
  definition.transport.onEvent((event) => adapterEvents.push(event));
  bus.register(definition);

  const seen: any[] = [];
  bus.subscribe((delivered) => {
    if (delivered.canonical) seen.push(delivered.canonical);
  });

  const started = Date.now();
  while (seen.length < V21_RAW.length && Date.now() - started < 2000) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  // Lossless: every @2.1 event keeps its canonical type through AdapterEvent.
  expect(seen.map((event) => event.payload.type)).toEqual([
    'session.created', 'queue.updated', 'background.job.updated', 'session.diff',
  ]);

  // @2.1 session.created has a flat `data` payload (no properties.info); the
  // AdapterEvent must still carry an identifiable session.
  const created = adapterEvents.find((event) => event.type === 'session.created');
  expect((created?.data.session ?? created?.data.info)?.id).toBe('s21');

  const queue = seen.find((event) => event.payload.type === 'queue.updated');
  expect(queue?.payload.properties).toMatchObject({
    sessionID: 's21', action: 'enqueued', item: { id: 'q1', text: 'later' },
  });

  const background = seen.find((event) => event.payload.type === 'background.job.updated');
  expect(background?.payload.properties.job).toMatchObject({ id: 'sh_1', sessionID: 's21' });

  const diff = seen.find((event) => event.payload.type === 'session.diff');
  expect(diff?.payload.properties).toMatchObject({ sessionID: 's21', diff: [{ file: 'a.ts' }] });
});

/**
 * The adapter package carries its own `toRuntimeDefinition` (it must not import
 * gateway source), so the two copies can drift silently. Same raw stream → same
 * canonical types and owners, whichever bridge produced them.
 */
it('gateway and adapter bridges emit the same canonical sequence for the same raw stream', async () => {
  const meta = {
    name: 'opencode',
    capabilities: {},
    translate: { entry: ENTRY, isCanonical: (type: string) => !!EVENT_FLOW_MATRIX[type] },
  };

  const viaAdapter = await collectCanonical(toRuntimeDefinition(fakeRuntime(RAW), meta), legacy.length);
  // The gateway bridge is typed against `AgentRuntime`; the shared fake runtime is
  // the same shape the adapter bridge accepts.
  const viaGateway = await collectCanonical(
    gatewayToRuntimeDefinition(fakeRuntime(RAW) as any, meta as any),
    legacy.length,
  );

  const types = (events: any[]) => events.map((event) => event.payload.type);
  const owners = (events: any[]) => events.map(semanticOwner);

  expect(viaAdapter).toHaveLength(legacy.length);
  expect(viaGateway).toHaveLength(legacy.length);

  // Pinned against the translated fixture, not just against each other: two
  // identically broken bridges would still pass a pure A/B comparison.
  expect(types(viaAdapter)).toEqual(legacy.map((event: any) => event.payload.type));
  expect(types(viaGateway)).toEqual(types(viaAdapter));
  expect(owners(viaGateway)).toEqual(owners(viaAdapter));
  expect(owners(viaGateway)).toEqual(legacy.map(semanticOwner));
});

