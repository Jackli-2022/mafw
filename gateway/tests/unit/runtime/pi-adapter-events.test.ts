import { mapAdapterEvent } from '../../../src/runtime/adapter-event-mapper';
import { translatePiAdapterEvent } from '../../../src/runtime/pi/pi-adapter-events';
import { PiEventStream } from '../../../src/runtime/pi/pi-events';

const liveMessage = {
  role: 'assistant',
  timestamp: 1700000000123,
  content: [{ type: 'text', text: 'hello' }],
  stopReason: 'stop',
};

describe('translatePiAdapterEvent', () => {
  it('maps agent_start / agent_end to turn lifecycle', () => {
    const started = translatePiAdapterEvent({ type: 'agent_start' }, 's1')!;
    expect(started.type).toBe('turn.started');
    expect(started.sessionID).toBe('s1');

    const done = translatePiAdapterEvent({ type: 'agent_end', messages: [liveMessage] }, 's1')!;
    expect(done.type).toBe('turn.completed');
    expect(mapAdapterEvent(done).canonical?.payload?.type).toBe('turn.completed');

    const failed = translatePiAdapterEvent({ type: 'agent_end', messages: [{ ...liveMessage, stopReason: 'error', errorMessage: 'boom' }] }, 's1')!;
    expect(failed.type).toBe('turn.failed');
    expect((failed.data as any).error.message).toBe('boom');

    expect(translatePiAdapterEvent({ type: 'agent_end', messages: [{ ...liveMessage, stopReason: 'aborted' }] }, 's1')!.type).toBe('turn.aborted');
  });

  it('maps message and delta events with stable ids', () => {
    const start = translatePiAdapterEvent({ type: 'message_start', sessionID: 's1', message: liveMessage }, 's1')!;
    expect(start.type).toBe('message.updated');
    expect((start.data as any).message.id).toBe('pia_1700000000123');
    expect((start.data as any).message.sessionID).toBe('s1');

    const delta = translatePiAdapterEvent({
      type: 'message_update', sessionID: 's1', message: liveMessage,
      assistantMessageEvent: { type: 'text_delta', delta: 'hi', contentIndex: 0 },
    }, 's1')!;
    expect(delta.type).toBe('part.delta');
    expect(delta.data).toMatchObject({
      messageID: 'pia_1700000000123',
      partID: 'pia_1700000000123_t1',
      field: 'text',
      delta: 'hi',
    });
  });

  it('maps tools and permissions', () => {
    const call = translatePiAdapterEvent({ type: 'tool_execution_start', sessionID: 's1', toolCallId: 'c1', toolName: 'bash', args: { command: 'ls' } }, 's1')!;
    expect(call.type).toBe('tool.call');
    expect(call.data).toMatchObject({ callID: 'c1', name: 'bash', input: { command: 'ls' } });

    const asked = translatePiAdapterEvent({ type: 'permission.asked', sessionID: 's1', requestId: 'r1', toolName: 'bash', args: {}, risk: 'low' }, 's1')!;
    expect(asked.type).toBe('permission.asked');
    expect(asked.requestID).toBe('r1');
    expect((asked.data as any).request.toolName).toBe('bash');

    const replied = translatePiAdapterEvent({ type: 'permission.replied', sessionID: 's1', requestId: 'r1', approved: true }, 's1')!;
    expect(replied.type).toBe('permission.replied');
    expect(replied.data).toMatchObject({ reply: 'once', approved: true, source: 'user' });
  });

  it('maps step parts and compaction', () => {
    expect(translatePiAdapterEvent({ type: 'turn_start' }, 's1')!.data).toMatchObject({ part: { type: 'step-start' } });
    expect(translatePiAdapterEvent({ type: 'turn_end' }, 's1')!.data).toMatchObject({ part: { type: 'step-finish' } });
    expect(translatePiAdapterEvent({ type: 'session_before_compact' }, 's1')!.type).toBe('session.compacting');
    expect(translatePiAdapterEvent({ type: 'session_compact' }, 's1')!.type).toBe('session.compacted');
  });

  it('drops unknown events', () => {
    expect(translatePiAdapterEvent({ type: 'mystery' }, 's1')).toBeNull();
    expect(translatePiAdapterEvent({}, 's1')).toBeNull();
  });

  it('PiEventStream emits AdapterEvent from the raw subscription', async () => {
    const stream = new PiEventStream(() => 's1');
    let handler: ((evt: any) => void) | undefined;
    stream.trackSession({ subscribe: (fn: any) => { handler = fn; } });
    const iterator = stream.stream()[Symbol.asyncIterator]();

    handler!({ type: 'agent_start' });
    const { value } = await iterator.next();
    expect(value.type).toBe('turn.started');
    expect(value.sessionID).toBe('s1');
  });
});
