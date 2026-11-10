import { readFileSync } from 'fs';
import { join } from 'path';
import { RuntimeBus } from '../../../src/runtime/runtime-bus';
import { toRuntimeDefinition } from '../../../src/runtime/legacy-plugin-bridge';
import { applyEventMappings } from '../../../src/runtime/event-mapper';
import { EVENT_FLOW_MATRIX } from '../../../src/runtime/event-flow-matrix';
import { OPENCODE_EVENT_SOURCE, OPENCODE_V1_EVENT_MAPPINGS, OPENCODE_V2_EVENT_MAPPINGS, OPENCODE_TRANSFORM_EVENT } from '../../../../adapters/opencode/src/events';
import { OPENCODE_21_EVENT_MAPPINGS, OPENCODE_21_EVENT_SOURCE, translateOpencode21Event } from '../../../../adapters/opencode/src/events-21';
import { translateNative } from '../../../../adapters/opencode/src/emit';
import { OpencodeTurnAttribution } from '../../../../adapters/opencode/src/turn-attribution';

const ENTRY = {
  eventSource: OPENCODE_EVENT_SOURCE,
  eventMappings: OPENCODE_V1_EVENT_MAPPINGS,
  transformEvent: OPENCODE_TRANSFORM_EVENT,
};

const V2_ENTRY = {
  eventSource: OPENCODE_EVENT_SOURCE,
  eventMappings: OPENCODE_V2_EVENT_MAPPINGS,
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

/**
 * Payload keys removed before the deep compare: bridge-local identity
 * (`turnID`, minted `id`/`at`) or the non-canonical `native` frame.
 *
 *  - `turnID` is minted by whichever copy owns the turn queue (`bridge-<sid>-
 *    bridge-<stamp>-<n>`); each module has its own counter;
 *  - `native` (when present) is the untouched upstream frame, not a canonical
 *    field;
 *  - `id` / `at` are stripped only because *some* events carry
 *    implementation-specific identity values at the top level (the bridge mints
 *    `id`/`at` per emitted AdapterEvent and can forward them into the payload),
 *    so the field name is removed rather than the value compared. This is not a
 *    claim that every `id` is volatile: `queue.updated.id`, for example, is the
 *    upstream `data.id` and is stable across both copies.
 *
 * Everything else must still be deep-equal: a copy that keeps the right event
 * type but loses or changes a property (e.g. `queue.updated.action`, or
 * `turn.completed.ok` flipping) is the drift this pin exists to catch.
 */
const VOLATILE_PAYLOAD_FIELDS = ['id', 'at', 'turnID', 'native'] as const;

/** `payload.properties` with the normalized-away identity fields removed. */
function stablePayload(event: any): Record<string, any> {
  const properties = { ...(event.payload?.properties ?? {}) };
  for (const field of VOLATILE_PAYLOAD_FIELDS) delete properties[field];
  return properties;
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

