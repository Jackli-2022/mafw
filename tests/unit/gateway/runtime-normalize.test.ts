import { normalizeOpencodeEvent } from '../../../gateway/src/runtime/normalize';

describe('normalizeOpencodeEvent', () => {
  it('unwraps GlobalEvent envelope and classifies session.idle', () => {
    const f = normalizeOpencodeEvent({
      directory: '/proj',
      payload: { type: 'session.idle', properties: { sessionID: 's1' } },
    });
    expect(f.type).toBe('session.idle');
    expect(f.sessionID).toBe('s1');
    expect(f.directory).toBe('/proj');
    expect(f.broadcast).toBe('idle');
    expect(f.chatSignal).toBe('complete');
    expect(f.step).toBeNull();
    expect(f.toolCommand).toBeUndefined();
  });

  it('classifies step-finish part as settled step', () => {
    const f = normalizeOpencodeEvent({
      payload: {
        type: 'message.part.updated',
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
      payload: { type: 'message.part.updated', properties: { part: { type: 'text', sessionID: 's1', text: 'hello' } } },
    });
    expect(f.chatSignal).toBe('delta');
    expect(f.deltaText).toBe('hello');
    expect(f.step).toBeNull();
  });

  it('classifies session.error', () => {
    const f = normalizeOpencodeEvent({
      payload: { type: 'session.error', properties: { sessionID: 's1', error: { message: 'boom' } } },
    });
    expect(f.broadcast).toBe('error');
    expect(f.chatSignal).toBe('error');
    expect(f.chatError).toEqual({ message: 'boom' });
  });

  it('extracts tool command only from tool-type events', () => {
    const toolEvt = normalizeOpencodeEvent({
      payload: { type: 'session.next.tool.finished', properties: { sessionID: 's1', tool: 'bash', args: { command: 'echo hi' } } },
    });
    expect(toolEvt.toolCommand).toBe('echo hi');

    const idle = normalizeOpencodeEvent({
      payload: { type: 'session.idle', properties: { sessionID: 's1', args: { command: 'echo hi' } } },
    });
    expect(idle.toolCommand).toBeUndefined();
  });

  it('falls back to bare event shape (no payload envelope) and passthrough for unknown types', () => {
    const f = normalizeOpencodeEvent({ type: 'custom.thing', properties: { sessionID: 's9' } });
    expect(f.type).toBe('custom.thing');
    expect(f.sessionID).toBe('s9');
    expect(f.broadcast).toBe('passthrough');
    expect(f.chatSignal).toBeNull();
    expect(f.step).toBeNull();
  });

  it('sessionID falls back through part/info/payload paths', () => {
    const viaPart = normalizeOpencodeEvent({
      payload: { type: 'message.part.updated', properties: { part: { type: 'text', sessionID: 'via-part' } } },
    });
    expect(viaPart.sessionID).toBe('via-part');
    const viaInfo = normalizeOpencodeEvent({
      payload: { type: 'message.updated', properties: { info: { role: 'user', sessionID: 'via-info', time: {} } } },
    });
    expect(viaInfo.sessionID).toBe('via-info');
  });
});
