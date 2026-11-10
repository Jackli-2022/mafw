/**
 * W1 native emission layer — golden matrix.
 *
 * The adapter keeps its raw → canonical dialect tables; this suite pins the
 * adapter-local canonical → `AdapterEvent` tail. Every row asserts the exact
 * `AdapterEvent.type` and `data` payload (not only the type), plus the
 * suppression/unmatched counters the tables already own.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateAdapterEvent } from '@mafw/runtime-contract';
import {
  OPENCODE_EVENT_SOURCE,
  OPENCODE_V1_EVENT_MAPPINGS,
  OPENCODE_V2_EVENT_MAPPINGS,
  OPENCODE_TRANSFORM_EVENT,
} from '../../../../adapters/opencode/src/events';
import {
  OPENCODE_21_EVENT_MAPPINGS,
  OPENCODE_21_EVENT_SOURCE,
  translateNative21,
  translateOpencode21Event,
} from '../../../../adapters/opencode/src/events-21';
import { translateNative } from '../../../../adapters/opencode/src/emit';
import { OpencodeTurnAttribution } from '../../../../adapters/opencode/src/turn-attribution';

type Dialect = 'v1' | 'v2' | 'v21';

interface GoldenRow {
  dialect: Dialect;
  name: string;
  event: any;
  expect: Array<{
    type: string;
    sessionID?: string;
    requestID?: string;
    data: Record<string, any>;
  }>;
  suppressed?: string[];
  unmatched?: string[];
}

const V1_ENTRY = {
  eventSource: OPENCODE_EVENT_SOURCE,
  eventMappings: OPENCODE_V1_EVENT_MAPPINGS,
  transformEvent: OPENCODE_TRANSFORM_EVENT,
};
const V2_ENTRY = {
  eventSource: OPENCODE_EVENT_SOURCE,
  eventMappings: OPENCODE_V2_EVENT_MAPPINGS,
  transformEvent: OPENCODE_TRANSFORM_EVENT,
};
const V21_ENTRY = {
  eventSource: OPENCODE_21_EVENT_SOURCE,
  eventMappings: OPENCODE_21_EVENT_MAPPINGS,
  transformEvent: translateOpencode21Event,
};

const ENTRIES: Record<Dialect, typeof V1_ENTRY> = { v1: V1_ENTRY, v2: V2_ENTRY, v21: V21_ENTRY };

const ROWS: GoldenRow[] = readFileSync(
  join(__dirname, '../../fixtures/events/opencode-native-golden.jsonl'),
  'utf8',
)
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as GoldenRow);

/** Stable projection: bridge-local identity (`id`/`at`/`turnID`) is not pinned. */
function project(events: any[]): any[] {
  return events.map((event) => ({
    type: event.type,
    sessionID: event.sessionID,
    requestID: event.requestID,
    data: event.data,
  }));
}

function run(row: GoldenRow) {
  const attribution = new OpencodeTurnAttribution();
  const suppressed: string[] = [];
  const unmatched: string[] = [];
  const errors: string[] = [];
  const hooks = {
    onSuppressed: (type: string) => suppressed.push(type),
    onUnmatched: (type: string) => unmatched.push(type),
    onTranslationError: (_raw: unknown, reason: string) => errors.push(reason),
  };
  const events = row.dialect === 'v21'
    // Exercise the dialect-bound helper for 2.1; the generic function is the
    // same tail (the v21 entry is the only difference).
    ? translateNative21(row.event, hooks, attribution)
    : translateNative(row.event, ENTRIES[row.dialect], hooks, attribution);
  return { events, suppressed, unmatched, errors };
}

for (const row of ROWS) {
  test(`${row.dialect}: ${row.name}`, () => {
    const { events, suppressed, unmatched, errors } = run(row);

    expect(errors).toEqual([]);
    expect(events).toHaveLength(row.expect.length);
    for (const event of events) {
      expect(validateAdapterEvent(event)).toMatchObject({ ok: true });
    }

    expect(project(events)).toEqual(row.expect);
    expect(suppressed).toEqual(row.suppressed ?? []);
    expect(unmatched).toEqual(row.unmatched ?? []);

    // `requestID` is a top-level AdapterEvent field (validation requires it for
    // permission/question events); pin presence/absence explicitly.
    events.forEach((event, index) => {
      const expected = row.expect[index];
      if (expected.requestID === undefined) expect(event.requestID).toBeUndefined();
      else expect(event.requestID).toBe(expected.requestID);
    });

    // Queue snapshots: `items` only when the payload really carried an array;
    // a 2.1 inbox frame must not synthesize an empty snapshot.
    events.forEach((event, index) => {
      if (event.type !== 'queue.updated') return;
      const expected = row.expect[index].data;
      if (Array.isArray(expected.items)) {
        expect(event.data.items).toEqual(expected.items);
      } else {
        expect(Object.prototype.hasOwnProperty.call(event.data, 'items')).toBe(false);
      }
    });
  });
}

describe('opencode native turn attribution', () => {
  function fresh() {
    return new OpencodeTurnAttribution();
  }

  function feed(attribution: OpencodeTurnAttribution, event: any) {
    return translateNative(event, V21_ENTRY, undefined, attribution);
  }

  const evt = (type: string, data: any, created = 1) => ({ id: `${type}-${created}`, created, type, data });

  test('three sendTurns queued while busy each get their own terminal', () => {
    const attribution = fresh();
    attribution.enqueue('s1', 'turn-a');
    attribution.enqueue('s1', 'turn-b');
    attribution.enqueue('s1', 'turn-c');

    const first = feed(attribution, evt('session.execution.started', { sessionID: 's1' }, 1));
    expect(first.map((event) => event.turnID)).toEqual(['turn-a']);

    const firstDone = feed(attribution, evt('session.execution.succeeded', { sessionID: 's1' }, 2));
    expect(firstDone.map((event) => [event.type, event.turnID])).toEqual([['turn.completed', 'turn-a']]);

    // A busy follow-up cannot relabel the running turn: the next start promotes
    // exactly one queued id.
    const second = feed(attribution, evt('session.execution.started', { sessionID: 's1' }, 3));
    expect(second.map((event) => event.turnID)).toEqual(['turn-b']);
    const secondDone = feed(attribution, evt('session.execution.succeeded', { sessionID: 's1' }, 4));
    expect(secondDone.map((event) => event.turnID)).toEqual(['turn-b']);

    const third = feed(attribution, evt('session.execution.started', { sessionID: 's1' }, 5));
    expect(third.map((event) => event.turnID)).toEqual(['turn-c']);
    const thirdDone = feed(attribution, evt('session.execution.interrupted', { sessionID: 's1' }, 6));
    expect(thirdDone.map((event) => event.turnID)).toEqual(['turn-c']);
    expect(attribution.hasInFlight('s1')).toBe(false);
  });

  test('frames after a synthetic abort cannot mint a new turn id', () => {
    const attribution = fresh();
    attribution.enqueue('s1', 'turn-a');
    attribution.enqueue('s1', 'turn-b');

    const startedEvents = feed(attribution, evt('session.execution.started', { sessionID: 's1' }, 1));
    expect(startedEvents[0]?.turnID).toBe('turn-a');

    // `interruptTurn` aborts the run and returns the id to terminate.
    expect(attribution.abort('s1')).toBe('turn-a');
    expect(attribution.activeTurnID('s1')).toBeUndefined();

    // Late native frames of the retired turn are suppressed, and no fallback id
    // is minted for them.
    expect(feed(attribution, evt('session.execution.succeeded', { sessionID: 's1' }, 2))).toEqual([]);
    expect(feed(attribution, evt('session.usage.updated', { sessionID: 's1' }, 3))).toEqual([]);
    expect(attribution.activeTurnID('s1')).toBeUndefined();
    // The queued next turn is untouched by the retired turn's late frames.
    expect(attribution.hasInFlight('s1')).toBe(true);
  });

  test('a terminal never consumes a withdrawn queued turn', () => {
    const attribution = fresh();
    attribution.enqueue('s1', 'turn-a');
    attribution.enqueue('s1', 'turn-b');
    attribution.withdraw('s1', 'turn-b');

    feed(attribution, evt('session.execution.started', { sessionID: 's1' }, 1));
    // A synthetic failure for the withdrawn turn must not eat the next queue
    // head. W2's transport pushes this frame directly (no native envelope).
    const failed = attribution.attribute({
      id: 'synthetic-fail',
      type: 'turn.failed',
      sessionID: 's1',
      turnID: 'turn-b',
      at: 1,
      data: { error: { kind: 'unknown', message: 'prompt rejected' }, retryable: false },
    });
    expect(failed?.turnID).toBe('turn-b');
    expect(attribution.activeTurnID('s1')).toBe('turn-a');
  });
});
