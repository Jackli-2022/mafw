import {
  createRuntimeFacade,
  RUNTIME_FACADE,
} from '../../../src/runtime/runtime-facade';
import type { EventMappingEntry } from '../../../src/runtime/event-mapper';

const ENTRY: EventMappingEntry = {
  eventSource: { typePath: '$.raw.type', sessionIdPath: '$.raw.sid' },
  eventMappings: [
    { from: 'done', to: 'turn.completed', fields: { sessionID: { path: '$.raw.sid' } } },
  ],
};

const isCanonical = (type: string) => type === 'turn.completed';

function makeRawRuntime() {
  const queue: any[] = [];
  let wake: (() => void) | null = null;
  const stream = {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (queue.length > 0) {
          yield queue.shift();
          continue;
        }
        await new Promise<void>((resolve) => { wake = resolve; });
      }
    },
  };
  const rt: any = {
    name: 'fake-runtime',
    capabilities: { eventStream: true },
    session: {
      async create() { return { id: 's1' }; },
      async messages() { return { data: [] }; },
    },
    global: { event: async () => ({ stream }) },
    getBaseUrl: () => 'http://127.0.0.1:1',
    resolveEventEntry: async () => ENTRY,
  };
  return {
    rt,
    push(raw: any) {
      queue.push(raw);
      const w = wake;
      wake = null;
      w?.();
    },
  };
}

async function nextEvent(facade: any): Promise<any> {
  const source = await facade.global.event();
  const iterator = (source.stream ?? source)[Symbol.asyncIterator]();
  const next = await iterator.next();
  await iterator.return?.();
  return next.value;
}

describe('RuntimeFacade', () => {
  it('drops untranslated raw events and exposes only canonical events', async () => {
    const { rt, push } = makeRawRuntime();
    const facade = await createRuntimeFacade(rt, { entry: ENTRY, isCanonical });
    const pending = nextEvent(facade);
    push({ raw: { type: 'mystery', sid: 's1' } });
    push({ raw: { type: 'done', sid: 's1' } });
    const event = await pending;
    expect(event.payload.type).toBe('turn.completed');
    expect(event.sessionID).toBe('s1');
  });

  it('hides raw wiring fields, private helpers and the raw prototype', async () => {
    const { rt } = makeRawRuntime();
    const facade: any = await createRuntimeFacade(rt, { entry: ENTRY, isCanonical });
    expect(facade[RUNTIME_FACADE]).toBe(true);
    expect(facade.__mafwRawGlobalEvent).toBeUndefined();
    expect(facade.__mafwEventWiring).toBeUndefined();
    expect(facade.__mafwActiveEntry).toBeUndefined();
    expect(facade.resolveEventEntry).toBeUndefined();
    expect(facade.registry).toBeUndefined();
    expect(Object.getPrototypeOf(facade)).toBe(Object.prototype);
  });

  it('rewireEvents keeps a single translation path', async () => {
    const { rt, push } = makeRawRuntime();
    const facade = await createRuntimeFacade(rt, { entry: ENTRY, isCanonical });
    await facade.rewireEvents();
    await facade.rewireEvents();
    const pending = nextEvent(facade);
    push({ raw: { type: 'done', sid: 's1' } });
    const event = await pending;
    expect(event.payload.type).toBe('turn.completed');
    expect(event.payload.properties).toEqual({ sessionID: 's1' });
  });
});
