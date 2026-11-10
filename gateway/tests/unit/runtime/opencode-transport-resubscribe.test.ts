/**
 * Phase 4 W5 — transport resubscribes after a stream teardown and re-probes the
 * adaptive dialect, without duplicating the old turn's events.
 */
import { createOpencodeTransport } from '../../../../adapters/opencode/src/transport';
import {
  OPENCODE_21_EVENT_MAPPINGS,
  OPENCODE_21_EVENT_SOURCE,
  translateOpencode21Event,
} from '../../../../adapters/opencode/src/events-21';

const V21_ENTRY = {
  eventSource: OPENCODE_21_EVENT_SOURCE,
  eventMappings: OPENCODE_21_EVENT_MAPPINGS,
  transformEvent: translateOpencode21Event,
};

function streamOf(events: any[]) {
  return (async function* () {
    for (const event of events) yield event;
  })();
}

function runtimeWith(streams: any[][]) {
  let call = 0;
  return {
    session: {
      create: async () => ({ id: 's1' }),
      promptAsync: async () => {},
      abort: async () => {},
    },
    global: {
      event: async () => {
        const events = streams[Math.min(call, streams.length - 1)] ?? [];
        call += 1;
        return { stream: streamOf(events) };
      },
    },
    calls: () => call,
  } as any;
}

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

describe('opencode transport reconnects', () => {
  it('resubscribes and re-probes after the event stream ends', async () => {
    const runtime = runtimeWith([
      [{ type: 'session.execution.started', data: { sessionID: 's1' } }],
      [{ type: 'session.execution.succeeded', data: { sessionID: 's1' } }],
    ]);
    const probes: string[] = [];
    const transport = createOpencodeTransport(runtime, {
      entry: V21_ENTRY,
      resolveEntry: async () => {
        probes.push('probe');
        return V21_ENTRY;
      },
    });
    const seen: any[] = [];
    const unsubscribe = transport.onEvent((event) => seen.push(event));
    const started = Date.now();
    while (seen.length < 2 && Date.now() - started < 2000) await tick();
    unsubscribe();

    expect(runtime.calls()).toBeGreaterThanOrEqual(2);
    expect(probes.length).toBeGreaterThanOrEqual(2);
    expect(seen.some((event) => event.type === 'turn.started')).toBe(true);
    expect(seen.some((event) => event.type === 'turn.completed')).toBe(true);
  });

  it('stops reconnecting after the last listener unsubscribes', async () => {
    const runtime = runtimeWith([[]]);
    const transport = createOpencodeTransport(runtime, { entry: V21_ENTRY });
    const unsubscribe = transport.onEvent(() => {});
    await tick(20);
    unsubscribe();
    const calls = runtime.calls();
    await tick(50);
    expect(runtime.calls()).toBe(calls);
  });
});
