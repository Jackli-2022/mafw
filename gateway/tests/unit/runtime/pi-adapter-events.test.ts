import { mapAdapterEvent } from '../../../src/runtime/adapter-event-mapper';
import { translatePiAdapterEvent } from '../../../../adapters/pi/src/pi-adapter-events';
import { PiEventStream } from '../../../../adapters/pi/src/pi-events';

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

  it('maps step parts and drops registry-owned compaction events', () => {
    expect(translatePiAdapterEvent({ type: 'turn_start' }, 's1')!.data).toMatchObject({ part: { type: 'step-start' } });
    expect(translatePiAdapterEvent({ type: 'turn_end' }, 's1')!.data).toMatchObject({ part: { type: 'step-finish' } });
    expect(translatePiAdapterEvent({ type: 'session_before_compact' }, 's1')).toBeNull();
    expect(translatePiAdapterEvent({ type: 'session_compact' }, 's1')).toBeNull();
  });

  it('drops extension-only tool hooks and unknown events', () => {
    expect(translatePiAdapterEvent({ type: 'tool_call' }, 's1')).toBeNull();
    expect(translatePiAdapterEvent({ type: 'tool_result' }, 's1')).toBeNull();
    expect(translatePiAdapterEvent({ type: 'mystery' }, 's1')).toBeNull();
    expect(translatePiAdapterEvent({}, 's1')).toBeNull();
  });

  it('suppresses user message_start but emits user message_end', () => {
    expect(translatePiAdapterEvent({ type: 'message_start', message: { role: 'user', timestamp: 1, content: 'hi' } }, 's1')).toBeNull();
    const end = translatePiAdapterEvent({ type: 'message_end', message: { role: 'user', timestamp: 1, content: 'hi' } }, 's1')!;
    expect((end.data as any).message.id).toBe('piu_1');
  });

  it('maps tool update/result and treats agent_end (not agent_settled) as the terminal', () => {
    expect(translatePiAdapterEvent({ type: 'tool_execution_update', sessionID: 's1', toolCallId: 'c1', partialResult: 'half' }, 's1')!.data)
      .toMatchObject({ callID: 'c1', field: 'output', delta: 'half' });
    const failed = translatePiAdapterEvent({ type: 'tool_execution_end', sessionID: 's1', toolCallId: 'c1', result: 'boom', isError: true }, 's1')!;
    expect(failed.data).toMatchObject({ callID: 'c1', ok: false, output: 'boom' });
    expect((failed.data as any).error).toBeUndefined();
    expect(translatePiAdapterEvent({ type: 'agent_end', messages: [{ role: 'assistant', stopReason: 'error', errorMessage: 'x' }] }, 's1')!.type).toBe('turn.failed');
    // pi emits agent_settled after agent_end; it must not produce a second terminal.
    expect(translatePiAdapterEvent({ type: 'agent_settled' }, 's1')).toBeNull();
  });

  it('does not emit a terminal while pi is auto-retrying', () => {
    expect(translatePiAdapterEvent({
      type: 'agent_end',
      willRetry: true,
      messages: [{ role: 'assistant', stopReason: 'error', errorMessage: 'rate limited' }],
    }, 's1')).toBeNull();
    expect(translatePiAdapterEvent({
      type: 'agent_end',
      willRetry: false,
      messages: [{ role: 'assistant', stopReason: 'stop' }],
    }, 's1')!.type).toBe('turn.completed');
  });

  it('PiEventStream emits AdapterEvent from the raw subscription (no event.session field)', async () => {
    const session = { subscribe: (_fn: any) => {} };
    const stream = new PiEventStream((candidate) => (candidate === session ? 's1' : undefined));
    let handler: ((evt: any) => void) | undefined;
    session.subscribe = (fn: any) => { handler = fn; };
    stream.trackSession(session);
    const iterator = stream.stream()[Symbol.asyncIterator]();

    // Real pi AgentEvent: no `session` property.
    handler!({ type: 'agent_start' });
    const { value } = await iterator.next();
    expect(value.type).toBe('turn.started');
    expect(value.sessionID).toBe('s1');
  });
});
