import { normalizeOpencodeEvent } from '../../../src/runtime/normalize';

describe('normalizeOpencodeEvent', () => {
  it('unwraps GlobalEvent envelope and classifies turn.completed', () => {
    const f = normalizeOpencodeEvent({
      directory: '/proj',
      payload: { type: 'turn.completed', properties: { sessionID: 's1' } },
    });
    expect(f.type).toBe('turn.completed');
    expect(f.sessionID).toBe('s1');
    expect(f.directory).toBe('/proj');
    expect(f.chatSignal).toBe('complete');
    expect(f.step).toBeNull();
    expect(f.toolCommand).toBeUndefined();
  });

  it('classifies step-finish part as settled step', () => {
    const f = normalizeOpencodeEvent({
      payload: {
        type: 'part.updated',
        properties: { part: { type: 'step-finish', sessionID: 's1', messageID: 'm1', reason: 'stop' } },
      },
    });
    expect(f.step).toEqual({ sessionID: 's1', assistantMessageID: 'm1', finish: 'stop' });
    expect(f.chatSignal).toBeNull();
  });

  it('classifies completed assistant message as settled step + complete signal', () => {
    const f = normalizeOpencodeEvent({
      payload: {
        type: 'message.updated',
        properties: { info: { id: 'm1', role: 'assistant', sessionID: 's1', time: { completed: 123 }, finish: 'stop' } },
      },
    });
    expect(f.step).toEqual({ sessionID: 's1', assistantMessageID: 'm1', finish: 'stop' });
    expect(f.chatSignal).toBe('complete');
  });

  it('ignores in-flight assistant message (no time.completed)', () => {
    const f = normalizeOpencodeEvent({
      payload: { type: 'message.updated', properties: { info: { id: 'm1', role: 'assistant', sessionID: 's1', time: {} } } },
    });
    expect(f.step).toBeNull();
  });

  it('extracts delta text from text part updates', () => {
    const f = normalizeOpencodeEvent({
      payload: { type: 'part.updated', properties: { part: { type: 'text', sessionID: 's1', text: 'hello' } } },
    });
    expect(f.chatSignal).toBe('delta');
    expect(f.deltaText).toBe('hello');
    expect(f.step).toBeNull();
  });

  it('classifies turn.failed (chatSignal error + chatError extraction)', () => {
    const f = normalizeOpencodeEvent({
      payload: { type: 'turn.failed', properties: { sessionID: 's1', error: { message: 'boom' } } },
    });
    expect(f.chatSignal).toBe('error');
    expect(f.chatError).toEqual({ message: 'boom' });
  });

  it('extracts tool command from tool part snapshots (v2 carrier)', () => {
    const toolEvt = normalizeOpencodeEvent({
      payload: { type: 'part.updated', properties: { part: { type: 'tool', sessionID: 's1', tool: 'bash', state: { status: 'running', input: { command: 'echo hi' } } } },
    });
    expect(toolEvt.toolCommand).toBe('echo hi');

    const text = normalizeOpencodeEvent({
      payload: { type: 'part.updated', properties: { part: { type: 'text', sessionID: 's1', text: 'hi' }, args: { command: 'echo hi' } } },
    });
    expect(text.toolCommand).toBeUndefined();
  });

  it('falls back to bare event shape (no payload envelope) and passthrough for unknown types', () => {
    const f = normalizeOpencodeEvent({ type: 'custom.thing', properties: { sessionID: 's9' } });
    expect(f.type).toBe('custom.thing');
    expect(f.sessionID).toBe('s9');
    expect(f.chatSignal).toBeNull();
    expect(f.step).toBeNull();
  });

  it('sessionID falls back through part/info/payload paths', () => {
    const viaPart = normalizeOpencodeEvent({
      payload: { type: 'part.updated', properties: { part: { type: 'text', sessionID: 'via-part' } } },
    });
    expect(viaPart.sessionID).toBe('via-part');
    const viaInfo = normalizeOpencodeEvent({
      payload: { type: 'message.updated', properties: { info: { role: 'user', sessionID: 'via-info', time: {} } } },
    });
    expect(viaInfo.sessionID).toBe('via-info');
  });

  it('maps session.compacted to compaction end facet', () => {
    const f = normalizeOpencodeEvent({
      payload: { type: 'session.compacted', properties: { sessionID: 's1' } },
    });
    expect(f.compaction).toBe('end');
    expect(f.sessionID).toBe('s1');
  });

  it('maps session.compacting to compaction start facet', () => {
    const f = normalizeOpencodeEvent({
      payload: { type: 'session.compacting', properties: { sessionID: 's1' } },
    });
    expect(f.compaction).toBe('start');
  });

  it('unrelated events have null compaction facet', () => {
    const f = normalizeOpencodeEvent({
      payload: { type: 'turn.completed', properties: { sessionID: 's1' } },
    });
    expect(f.compaction).toBeNull();
  });
});
